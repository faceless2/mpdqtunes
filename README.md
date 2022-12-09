# mpdwsproxy

An ultra-simple web-server which acts as a proxy between an MPD[https://musicpd.org] server and a web-client. Intended to serve as a basic starting point for any MPD web-client.

When the web-client connects to a websocket on the `/ws` path, a new connection is opened to the MPD server. Any text-messages from the web-client are relayed to MPD, and any text or binary responses are relayed back, with one line (or one binary object) per message.

Has no knowledge of the MPD protocol at all, other than the `binary: n` line. So this proxy will never go out of date as new features are added to the protocol.

Any HTTP requests for paths other than `/ws` are served from the filesystem.
