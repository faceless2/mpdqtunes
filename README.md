# mpdwsproxy

An ultra-simple web-server which acts as a proxy between an [MPD](https://musicpd.org) server and a web-client. Intended to serve as a basic starting point for any MPD web-client.

When the web-client connects to a websocket on the `/ws` path, a new connection is opened to the MPD server. Any text-messages from the web-client are relayed to MPD, and any text or binary responses are relayed back, with one line (or one binary object) per message. Each Websocket connection has its own MPD connection, so the web-server can handle many connections independently.

Has no knowledge of the MPD protocol at all, other than the `binary: n` line. So this proxy will never go out of date as new features are added to the protocol.

Any HTTP requests for paths other than `/ws` are served from the filesystem.

Thanks to the [Moongoose](https://mongoose.ws) project for all the web-server bits.

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
       tx("status");
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
