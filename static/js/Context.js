/**
 * A context is a single WS connection. One per application
 */
class Context extends EventTarget {
    #ws
    #q = [];
    #rx = [];
    #lastActive;
    debug = ["tx"];        // also "rx"
    servers = [];
    active;                     // the currently active TrackList
    preferences;
    countcmd = "searchcount";         // which is case-sensitive! See https://github.com/MusicPlayerDaemon/MPD/pull/1691

    availableColumns = { index: "#", album: "Album", artist: "Artist", title: "Title", albumartist: "Album Artist", track: "Track", date: "Year", genre: "Genre", composer: "Composer", file: "File", disc: "Disc", duration: "Duration", time: "Time" };
    defaultColumns = [ "album", "artist", "albumartist", "title", "track", "date" ];


    constructor(url) {
        super();
        if (!url) {
            url = (location.protocol == "https" ? "wss://" : "ws://") + location.host + "/ws";
        }
        this.#ws = new WebSocket(url);
        this.#ws.binaryType = "arraybuffer";


        const that = this;
        this.#ws.addEventListener("message", (e) => {
            const v = e.data;
            const text = !(v instanceof ArrayBuffer);
            let sv = v;
            if (text) {
                let i = v.indexOf(": ");
                if (i) {
                    sv = {key:v.substring(0, i), value: v.substring(i + 2), toString: () => { return v; }};
                }
            }
            if (that.#q.length && that.#q[0].sent) {
                let cmd = that.#q[0];
                if (that.debug.includes("rx")) {
                    console.debug("RX " + (text ? v : "<binary " + v.byteLength + " bytes>"));
                }
                let err = null;
                if (text) {
                    if (!v.length) {
                        return;
                    } else if (typeof(cmd.tx) == "string" && cmd.tx.startsWith("proxy-connect ") && v.startsWith("OK MPD ")) {
                        cmd.rx.push({key:"hello", value:v, toString: () => { return v; }});
                    } else if (v == "OK") {
                        // noop
                    } else if (v.startsWith("ACK ")) {
                        console.warn((typeof(cmd.tx) == "string" ? cmd.tx : JSON.stringify(cmd.tx)) + " -> " + v);
                        err = v.substring(4);
                    } else {
                        cmd.rx.push(sv);
                        return;
                    }
                } else {
                    cmd.rx.push({key:"binary", value:v, toString: () => { return "binary: <" + value.byteLength + " bytes>"; }});
                    return;
                }
                that.#q.shift();
                if (cmd.callback) {
                    cmd.callback(err, cmd.rx);
                }
                that.#poll();
            } else {
                that.dispatchEvent(new CustomEvent("orphanread", { data: sv }));
            }
        });
        that.#ws.addEventListener("open", (e) => {
            that.#poll();
        });
        that.#ws.addEventListener("close", (e) => {
            // whatever
        });
        this.preferences = localStorage.getItem("preferences");
        if (this.preferences) {
            try {
                this.preferences = JSON.parse(this.preferences);
                // Clear empty objects. We can only do this on load, never on save - if we remove items, we won't pick up later changes
                for (let key in this.preferences) {
                    if (typeof(this.preferences[key]) == "object" && Object.keys(this.preferences[key]).length == 0) {
                        delete this.preferences[key];
                    }
                }
            } catch (e) {
                this.preferences = {};
            }
        }
        if (!this.preferences) {
            this.preferences = {};
        }
        if (this.preferences.columnResize) {
            for (let id in this.preferences.columnResize) {
                let elt = document.getElementById(id);
                if (elt) {
                    elt.style.width = this.preferences.columnResize[id];
                }
            }
        }
    }

    #poll() {
        if (this.#ws.readyState == 1 && this.#q.length && !this.#q[0].sent) {
            const debug = this.debug.includes("tx");
            const cmd = this.#q[0];
            cmd.sent = true;
            if (typeof(cmd.tx) == "string") {
                if (debug) {
                    console.debug("TX " + cmd.tx);
                }
                this.#ws.send(cmd.tx);
            } else {
                cmd.tx.unshift("command_list_begin");
                cmd.tx.push("command_list_end");
                for (let s of cmd.tx) {
                    if (debug) {
                        console.debug("TX " + s);
                    }
                    this.#ws.send(s);
                }
            }
        }
    }

    tx(cmd, callback) {
        if (Array.isArray(cmd)) {
            for (let s of cmd) {
                if (typeof(s) != "string") {
                    throw new Error("invalid cmd type");
                }
            }
            if (cmd.length == 1) {
                cmd = cmd[0];
            }
        } else if (typeof(cmd) != "string") {
            throw new Error("invalid cmd type");
        }
        this.#q.push({tx:cmd, rx: [], callback: callback, sent: false});
        this.#poll();
    }

    addServer(opts) {
        opts.ctx = this;
        const server = new Server(opts);
        this.servers.push(server);
        // Add navigation nodes
        let tree = document.getElementById("server-navigation-template").cloneNode(true);
        tree.id = "";
        tree.setAttribute("data-for", server.id);
        document.getElementById("nav").appendChild(tree);
        tree.querySelectorAll("[data-field=\"name\"]").forEach((e)=> {
            e.innerHTML = server.name;
        });
        tree.querySelectorAll("[data-action=\"selectserver\"]").forEach((e)=> {
            e.addEventListener("click", (e) => {
                ctx.activate(server.id + "_Library");
            });
            e.innerHTML = server.name;
        });
        this.dispatchEvent(new Event("servers"));
    }

    activate(id) {
        if (id.length && id.charAt(0) == '#') {
            id = id.substring(1);
        }
        let newActive;
        for (let server of this.servers) {
            if (server.library) {
                if (id == server.library.id) {
                    newActive = server.library;
                }
                for (let playlist of server.playlists) {
                    if (id == playlist.id) {
                        newActive = playlist;
                    }
                }
                for (let partition of server.partitions) {
                    if (id == partition.id) {
                        newActive = partition;
                    }
                }
            } else if (id.startsWith(server.id + "_")) {
                // First step is connect to that server
                console.log("activate \"" + id + "\": server \"" + server.id + "\" not loaded, loading");
                const f = (e) => {
                    if (e.type == "connect") {
                        ctx.activate(id);
                    } else {
                        ctx.activate(this.#lastActive);
                    }
                    document.querySelectorAll("#nav [data-for=\"" + server.id + "\"]").forEach((e) => {
                        e.classList.toggle("disabled", server.failed);
                    });
                    server.removeEventListener("connect", f);
                    server.removeEventListener("connectfail", f);
                };
                server.addEventListener("connect", f);
                server.addEventListener("connectfail", f);
                server.connect();
                return;
            }
        }
        if (newActive) {
            if (location.hash != "#" + id) {
                console.log("activate \"" + id + "\": set hash");
                location.hash = "#" + id;
                return true;
            } else if (!this.active && !this.#lastActive) {
                console.log("activate \"" + id + "\": flip to force target refresh");
                this.#lastActive = id;
                this.active = newActive;
                location.hash = "#dummy-flip";
                return false;
            } else {
                console.log("activate \"" + id + "\": actually activate");
                let oldserver;
                if (this.active) {
                    this.active.activate(false);
                    this.#lastActive = this.active.id;
                    if (this.active.server.id != newActive.server.id) {
                        document.querySelectorAll("#nav [data-for=\"" + this.active.server.id + "\"]").forEach((e) => {
                            e.classList.remove("active");
                        });
                    }
                }
                document.querySelectorAll("#nav [data-for=\"" + newActive.server.id + "\"]").forEach((e) => {
                    e.classList.add("active");
                });
                if (newActive.type == "partition") {
                    newActive.server.activePartition = newActive;
                }
                document.querySelectorAll("#nav .partition.active").forEach((e) => {
                    e.classList.remove("active");
                });
                if (newActive.server.activePartition) {
                    document.querySelectorAll("#nav [data-for=\"" + newActive.server.activePartition.id + "\"]").forEach((e) => {
                        e.classList.add("active");
                    });
                }
                this.active = newActive;
                this.active.server.connect();
                this.active.activate(true);
                // Next line to ensure target is updated
                return true;
            }
        } else if (!this.active) {
            // If we get here, we've either
            //  * not asked for any thing, or asked for a server that doesn't exist
            //  * asked for a playlist/partion not existing on a server that does exist.
            for (let server of this.servers) {
                if (id.startsWith(server.id + "_") && server.library) {
                    // Server exists, but playlist doesn't. Select library.
                    console.log("activate \"" + id + "\": found server, fallback to library");
                    return this.activate(server.library.id);
                }
            }
            for (let server of this.servers) {
                if (!server.failed) {
                    // Try first non-failed server.
                    console.log("activate \"" + id + "\": fallback to \"" + server.id + "\" library");
                    return this.activate(server.id + "_Library");
                }
            }
            // We're stuffed.
            return false;
        } else {
            console.log("activate \"" + id + "\": fallback to previous \"" + this.#lastActive + "\"");
            location.hash = "#" + this.#lastActive;
        }
        return false;
    }

    esc(z) {
        for (let i=0;i<z.length;i++) {
            let c = z.charAt(i);
            if (c == '\\' || c == '"') {
                z = z.substring(0, i) + '\\' + z.substring(i);
                i++;
            }
        }
        return z;
    }

    sanitize(z) {
        let out = "";
        for (let i=0;i<z.length;i++) {
            let c = z.charAt(i);
            // Keep only chars that we can use for CSS without escaping, but strip underscore which we use as separator.
            // This is the pre 2022 list
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9' && i > 0) || (c == '-' && i > 0)) {
                out += c;
            }
        }
        return out;
    }

    savePreferences() {
        localStorage.setItem("preferences", JSON.stringify(this.preferences));
    }

    getAllTrackLists() {
        let a = [];
        for (let server of this.servers) {
            if (server.library) {
                a.push(server.library);
            }
            if (server.partitions) {
                for (let partition of server.partitions) {
                    a.push(partition);
                }
            }
            if (server.playlists) {
                for (let playlist of server.playlists) {
                    a.push(playlist);
                }
            }
        }
        return a;
    }

}
