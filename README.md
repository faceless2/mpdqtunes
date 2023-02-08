# mpdqtunes

A clean web-interface onto one or more [MPD](https://musicpd.org) servers.

* Supports multiple MPD servers, multiple partitions (players) and multiple outputs within a single user-interface.
* Autodiscovery via ZeroConf
* Simple design - no frameworks!

The project is in two parts

## Proxy server

An ultra-simple web-server which acts as a proxy between one or more [MPD](https://musicpd.org) server and one or more web-clients. MPD servers are discovered automaticallty by Zeroconf (although this is optional).

Intended to serve as a basic starting point for any MPD web-client, by default it embeds the web-interface parts of this project but can also server files from the filesystem.

The web-client connects to a websocket on the `/ws` path and sends a text message with `proxy-listservers`. The reply lists all the known servers
(either specified manually or found by zeroconf). The `proxy-connect` command will connect to the named server, and from there all communication
is with the MPD server itself, one text-message per line (when the MPD server returns binary data it is sent as a binary message). To disconnect, either
close the websocket connection or issue another `proxy-connect` command to a different server.
Multiple clients can be connected independently to multiple servers.

Has no knowledge of the MPD protocol at all, other than the `binary: n` line. So this proxy will never go out of date as new features are added to the protocol.

Any HTTP requests for paths other than `/ws` are served from the filesystem.

Thanks to the [Moongoose](https://mongoose.ws) project for all the web-server bits.

### Building
Type `make`. To build with Zeroconf support, install `libavahi-client-dev` before you type `make`

## Web Client

![bg](https://user-images.githubusercontent.com/989243/217526602-7e46e060-8022-4443-823b-0db887212ba2.jpg)

I couldn't find a client that could handle multiple partitions from a single interface, or that didn't depend on a dozen different frameworks, so this was the result. It's inspired by the iTunes interface before iTunes went bad.

* Tested with 50,000+ tracks, the main Library is presented as a single table, but scrolling loads more data
* Tables can be sorted, filtered, columns resized, reordered or hidden.
* Tracks are dragged onto players or playlists, or double-click to play immediately.
* JS and stylesheets are commented and as clean as I can get them.


## Standalone Example

If you want to try the server side without the embedded client, run `make`, Put this file in the current directory as `index.html`, run `mpd`, run `mpqqtunes --root .` then connect to `http://localhost:8000`.

```html
<!DOCTYPE html>
<html>
 <head>
  <meta charset="utf-8">
  <script>
   let ws;
   function add(text, cl) {
     let n = document.createElement("span");
     n.classList.add(cl);
     n.appendChild(document.createTextNode(text));
     document.getElementById("output").appendChild(n);
     n.scrollIntoView();
   }
   function rx(text) {
     add(text, "rx");
   }
   function tx(text) {
     add(text, "tx");
     ws.send(text);
   }
   function init() {
     ws = new WebSocket("ws://" + location.host + "/ws");
     ws.addEventListener("message", (e) => {
       rx(e.data);
     });
     ws.addEventListener("open", (e) => {
       tx("proxy-listservers");
     });
     document.getElementById("input").addEventListener("change", (e) => { 
       console.log(e);
       tx(e.target.value);
       e.target.value = "";
     });
   }
   document.addEventListener("DOMContentLoaded", init);
  </script>
  <style>
   span, input { display: block; font: 16px monospace; width: 100% }
   #output { height: 20em; overflow-y: scroll; border: 1px solid gray; padding: 6px }
   .rx { color: #008; }
   .tx { color: #800; }
  </style>
 </head>
 <body>
  <h1>MPD console</h1>
  <div id="output">
  </div>
  <input id="input">
 </body>
</html>
```

## Example communications
<pre><code>
<b><i>proxy-listservers</i></b>
name: server1[20071]
host: server1.local
port: 6600
name: server2[18063]
host: server2.local
port: 6600
OK
<b><i>proxy-connect "server1[20071]"</i></b>
OK MPD 0.24.0
<b><i>stats</i></b>
uptime: 22
playtime: 0
artists: 1
albums: 10
songs: 134
db_playtime: 34557
db_update: 1671021242
OK
<b><i>proxy-connect "server2[18063]"</i></b>
OK MPD 0.24.0
<b><i>stats</i></b>
uptime: 74218
playtime: 7521
artists: 1386
albums: 510
songs: 6713
db_playtime: 1757429
db_update: 1670512904
OK
</code></pre>

