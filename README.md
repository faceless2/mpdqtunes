# mpdwsproxy

An ultra-simple web-server which acts as a proxy between one or more [MPD](https://musicpd.org) server and one or more web-clients.
Intended to serve as a basic starting point for any MPD web-client.

The web-client connects to a websocket on the `/ws` path and sends a text message with `proxy-listservers`. The reply lists all the known servers
(either specified manually or found by zeroconf). The `proxy-connect` command will connect to the named server, and from there all communication
is with the MPD server itself, one text-message per line (when the MPD server returns binary data it is sent as a binary message). To disconnect, either
close the websocket connection or issue another `proxy-connect` command to a different server.
Multiple clients can be connected independently to multiple servers.

Has no knowledge of the MPD protocol at all, other than the `binary: n` line. So this proxy will never go out of date as new features are added to the protocol.

Any HTTP requests for paths other than `/ws` are served from the filesystem.

Thanks to the [Moongoose](https://mongoose.ws) project for all the web-server bits.

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


## Example

Run `make`, Put this file in the current directory as `index.html`, run `mpd`, run `mpdwsproxy` then connect to `http://localhost:8000`.

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

## Building
Type `make`. To build with Zeroconf support, install `libavahi-client-dev` then type `make`
