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
