class Server extends EventTarget {
    name;
    ctx;
    library;
    partitions = [];
    playlists = [];
    covers = {};        // Map of file->blob URL

    constructor(opts) {
        super();
        this.ctx = opts.ctx;
        this.name = opts.name;
        this.id = this.ctx.sanitize(this.name);
    }

    #disconnect() {
        this.connected = false;
    }

    connect() {
        const server = this;
        if (!ctx.active || ctx.active.server != this) {
            ctx.tx("proxy-connect \"" + this.ctx.esc(this.name) + "\"", (err,rx) => {
                if (!err) {
                    if (ctx.active && ctx.active.server) {
                        ctx.active.server.#disconnect();
                    }

                    ctx.tx("stats", (err,rx) => {
                        for (let l of rx) {
                            server[l.key] = l.value;
                        }
                    });
                    ctx.tx("listpartitions", (err,rx) => {
                        for (let l of rx) {
                            if (l.key == "partition") {
                                server.addPartition(l.value);
                            }
                        }
                        ctx.tx("listplaylists", (err,rx) => {
                            for (let l of rx) {
                                if (l.key == "playlist") {
                                    server.addPlaylist(l.value, true);
                                }
                            }
                            document.querySelectorAll("#nav [data-for=\"" + server.id + "\"] [data-field=\"playlists\"]").forEach((e) => {
                                let a = document.createElement("a");
                                a.appendChild(document.createTextNode("Create New Playlist"));
                                a.setAttribute("data-action", "newplaylist");
                                e.appendChild(a);
                            });
                            if (!ctx.active) {
                                // Called after partitions/playlists loaded
                                ctx.activate(location.hash);
                            }
                        });
                    });

                    // Add library to main
                    const tree = document.getElementById("library-template").cloneNode(true);
                    document.getElementById("main").appendChild(tree);
                    server.library = new Library({
                        server: server,
                        name: "Library",
                        elt: tree,
                        elt_table: tree.querySelector(".table")
                    });

                    // Populate nav
                    document.querySelectorAll("#nav [data-for=\"" + server.id + "\"] [data-field=\"library\"]").forEach((e) => {
                        let a = document.createElement("a");
                        a.classList.add("library");
                        a.href = "#" + server.library.id;
                        a.innerHTML = server.library.name;
                        a.trackList = server.library;
                        a.setAttribute("data-for", server.library.id);
                        e.appendChild(a);
                    });
                    // Populate fields
                    tree.querySelectorAll("[data-action=\"filter\"]").forEach((e)=> {
                        e.addEventListener("change", (e) => {
                            server.library.filter = "\"(any contains \\\"" + e.target.value + "\\\")\"";
                            server.library.reload();
                        });
                    });
                    this.#addArtworkListener(tree, server.library);
                    server.connected = true;
                    server.failed = false;
                    console.log("server \"" + server.id + "\" connected");
                    server.dispatchEvent(new Event("connect"));
                } else {
                    server.connected = false;
                    server.failed = true;
                    console.log("server \"" + server.id + "\" connection failed");
                    server.dispatchEvent(new Event("connectfail"));
                }
            });
        }
    }

    createPlaylist(name, files, columns) {
        let l = [];
        for (let f of files) {
            l.push("playlistadd \"" + ctx.esc(name) + "\" \"" + ctx.esc(f) + "\" " + l.length);
        }
        ctx.tx(l, (err, rx) => {
            let playlist = this.addPlaylist(name, true, columns);
            playlist.elt_nav.scrollIntoView();
            playlist.elt_nav.classList.add("newly-added");
            setTimeout(()=>{
                playlist.elt_nav.classList.remove("newly-added");
            }, 5000);
        });
    }

    addPlaylist(name, sort, columns) {
        const server = this;
        const tree = document.getElementById("playlist-template").cloneNode(true);
        tree.id = "";
        document.getElementById("main").appendChild(tree);
        const playlist = new Playlist({
            server: server,
            name: name,
            elt: tree,
            elt_table: tree.querySelector(".table"),
            columns: columns
        });
        server.playlists.push(playlist);
        if (sort) {
            server.playlists.sort((a,b) => {
                return a.name.localeCompare(b.name, "en", { ignorePunctuation: true, sensitivity: "base" });
            });
        }

        // Populate nav
        document.querySelectorAll("#nav [data-for=\"" + server.id + "\"] [data-field=\"playlists\"]").forEach((e) => {
            let a = document.createElement("a");
            a.appendChild(document.createTextNode(playlist.name));
            a.classList.add("playlist");
            a.trackList = playlist;
            a.href = "#" + playlist.id;
            a.setAttribute("data-for", playlist.id);
            a.addEventListener("dblclick", () => {
                server.activePartition.reorder(0, server.activePartition.tracks.length, null);
                ctx.tx("load \"" + ctx.esc(playlist.name) + "\"");
                server.activePartition.play(0);
            });
            let ix = server.playlists.indexOf(playlist);
            if (ix < 0 || ix >= e.children.length) {
                e.appendChild(a);
            } else {
                e.insertBefore(a, e.children[ix]);
            }
            if (!playlist.elt_nav) {
                playlist.elt_nav = a;
            }
        });
        // Populate input widgets
        tree.querySelectorAll("[data-action=\"name\"]").forEach((e) => {
            e.addEventListener("change", (e) => {
                let oldid = playlist.id;
                playlist.rename(e.target.value);
                let newid = playlist.id;

                document.querySelectorAll("a[data-for=\"" + oldid + "\"], [data-for=\"" + oldid + "\"] [data-field=\"name\"]").forEach((e) => {
                    if (e.tag == "a") {
                        e.href = "#" + newid;
                    }
                    e.innerHTML = playlist.name;
                });
                document.querySelectorAll("[data-for=\"" + oldid + "\"]").forEach((e)=> {
                   e.setAttribute("data-for", newid);
                });
                document.getElementById(oldid).id = newid;
                if (window.location.href == "#" + oldid) {
                    window.location.href = "#" + newid;
                }
            });
        });
        tree.querySelectorAll("[data-action=\"destroy\"]").forEach((e) => {
            e.addEventListener("click", (e) => {
                playlist.destroy();
                document.querySelectorAll("[data-for=\"" + playlist.id + "\"]").forEach((e)=> {
                   e.remove();
                });
            });
        });
        // Populate output widgets
        tree.querySelectorAll("[data-field=\"name\"]").forEach((e) => {
            if (e.tagName == "INPUT") {
                e.value = playlist.name;
            } else {
                e.innerHTML = playlist.name;
            }
        });

        server.#addArtworkListener(tree, playlist);
        return playlist;
    }

    addPartition(name) {
        const server = this;
        const tree = document.getElementById("partition-template").cloneNode(true);
        tree.id = "";
        document.getElementById("main").appendChild(tree);
        const partition = new Partition({
            server: server,
            name: name,
            elt: tree,
            elt_table: tree.querySelector(".table")
        });
        if (!server.partitions.length) {
            server.activePartition = partition;
        }
        server.partitions.push(partition);

        // Populate nav
        document.querySelectorAll("#nav [data-for=\"" + server.id + "\"] [data-field=\"partitions\"]").forEach((e) => {
            let a = document.createElement("a");
            a.classList.add("partition");
            if (partition == server.activePartition) {
                a.classList.add("active");
            }
            a.appendChild(document.createTextNode(partition.name));
            a.trackList = partition;
            a.href = "#" + partition.id;
            a.setAttribute("data-for", partition.id);
            e.appendChild(a);
        });
        // Populate input widgets
        tree.querySelectorAll("[data-action=\"volumeup\"]").forEach((e) => {
            e.addEventListener("click", (e) => {
                partition.setVolume(partition.volume + 5);
            });
        });
        tree.querySelectorAll("[data-action=\"volumedown\"]").forEach((e) => {
            e.addEventListener("click", (e) => {
                partition.setVolume(partition.volume - 5);
            });
        });
        tree.querySelectorAll("input[data-action=\"volume\"]").forEach((e) => {
            e.addEventListener("change", (e) => {
                partition.setVolume(e.target.value);
            });
        });
        tree.querySelectorAll("input[data-action=\"position\"]").forEach((e) => {
            e.addEventListener("change", (e) => {
                partition.setPosition(e.target.value);
            });
        });
        tree.querySelectorAll("[data-action=\"next\"]").forEach((e) => {
            e.addEventListener("click", (e) => {
                partition.skip(1);
            });
        });
        tree.querySelectorAll("[data-action=\"previous\"]").forEach((e) => {
            e.addEventListener("click", (e) => {
                partition.skip(-1);
            });
        });
        tree.querySelectorAll("[data-action=\"play\"]").forEach((e) => {
            e.addEventListener("click", (e) => {
                partition.play(e.target.getAttribute("data-actionvalue"));
            });
        });
        tree.querySelectorAll("[data-action=\"mode\"]").forEach((e) => {
            e.addEventListener("click", (e) => {
                partition.setMode(e.target.getAttribute("data-actionvalue"));
            });
        });
        tree.querySelectorAll("[data-action=\"random\"]").forEach((e) => {
            e.addEventListener("click", (e) => {
                partition.setRandom(e.target.getAttribute("data-actionvalue"));
            });
        });
        tree.querySelectorAll("[data-action=\"replaygain\"]").forEach((e) => {
            e.addEventListener("click", (e) => {
                partition.setReplayGain(e.target.getAttribute("data-actionvalue"));
            });
        });
        tree.querySelectorAll("[data-action=\"destroy\"]").forEach((e) => {
            e.addEventListener("click", (e) => {
                partition.destroy();
                document.querySelectorAll("[data-for=\"" + partition.id + "\"]").forEach((e)=> {
                    e.remove();
                });
            });
        });
        tree.querySelectorAll(".popup").forEach((e) => {
            let a = e.parentNode;
            a.addEventListener("click", (ev) => {
                e.classList.toggle("hidden");
            });
        });
        // Populate output widgets
        tree.querySelectorAll("[data-field=\"name\"]").forEach((e) => {
            if (e.tagName == "INPUT") {
                e.value = partition.name;
            } else {
                e.innerHTML = partition.name;
            }
        });
        partition.addEventListener("playing", (e) => {
            tree.querySelectorAll("[data-field=\"playstate\"]").forEach((e) => {
                e.setAttribute("data-value", partition.playstate);
            });
            tree.querySelectorAll("[data-action=\"position\"]").forEach((e) => {
                e.disabled = partition.playstate != "play";
            });
        });
        partition.addEventListener("volume", (e) => {
            tree.querySelectorAll("[data-field=\"volume\"]").forEach((e) => {
                e.setAttribute("data-value", e.innerHTML = Math.round(partition.volume) + "%");
            });
            tree.querySelectorAll("input[data-action=\"volume\"]").forEach((e) => {
                e.value = partition.volume;
            });
        });
        partition.addEventListener("mode", (e) => {
            tree.querySelectorAll("[data-field=\"mode\"]").forEach((e) => {
                e.setAttribute("data-value", partition.mode);
            });
        });
        partition.addEventListener("replaygain", (e) => {
            tree.querySelectorAll("[data-field=\"replaygain\"]").forEach((e) => {
                e.setAttribute("data-value", partition.replaygain);
            });
        });
        partition.addEventListener("random", (e) => {
            tree.querySelectorAll("[data-field=\"random\"]").forEach((e) => {
                e.setAttribute("data-value", partition.random);
            });
        });
        partition.addEventListener("elapsed", (e) => {
            tree.querySelectorAll("[data-action=\"position\"]").forEach((e) => {
                e.value = partition.elapsed;
                e.max = partition.duration;
            });
            let v = partition.elapsed;
            let v0 = v == 0 ? "-:--" : Math.floor(v / 60000) + ":" + String(Math.floor((v % 60000)/1000)).padStart(2, "0");
            v = partition.duration;
            let v1 = v == 0 ? "-:--" : Math.floor(v / 60000) + ":" + String(Math.floor((v % 60000)/1000)).padStart(2, "0");
            tree.querySelectorAll("[data-field=\"position\"]").forEach((e) => {
                e.setAttribute("data-value", e.innerHTML = v0 + " / " + v1);
            });
        });
        partition.addEventListener("outputlist", (e) => {
            tree.querySelectorAll(".popup[data-action=\"outputselect\"]").forEach((e) => {
                while (e.lastChild) {
                    e.remove(e.lastChild);
                }
                for (let i=0;i<partition.outputs.length;i++) {
                    let output = partition.outputs[i]
                    if (output.plugin == "dummy") {
                        // This means the output has been moved to another partition
                        continue;
                    }
                    let a = document.createElement("a");
                    e.appendChild(a);
                    a.setAttribute("data-output", output.outputname);
                    a.appendChild(document.createTextNode(output.outputname));
                    a.classList.toggle("disabled", output.outputenabled*1 == 0);
                    a.addEventListener("click", (e) => {
                        if (output.outputenabled != "1") {
                            ctx.tx("enableoutput " + i, (err, rx) => {
                                if (!err) {
                                    output.outputenabled = "1"
                                    a.classList.remove("disabled");
                                }
                            });
                        } else {
                            ctx.tx("disableoutput " + i, (err, rx) => {
                                if (!err) {
                                    output.outputenabled = "0";
                                    a.classList.add("disabled");
                                }
                            });
                        }
                    });
                }
            });
        });
        server.#addArtworkListener(tree, partition);
    }

    #addArtworkListener(tree, tracklist) {
        tracklist.addEventListener("select", (e) => {
            let t = tracklist.getSelection();
            if (t && t.start) {
                let file = tracklist.tracks[t.start.row].file;
                this.#loadArtwork(tree, "[data-field=\"cover-selection\"]", tracklist, file);
            }
        });
        tracklist.addEventListener("track", (e) => {
            let file;
            if (typeof(tracklist.track) == "number") {
                let track = tracklist.tracks[tracklist.track];
                file = track ? track.file : null;
            } else {
                file = null;
            }
            this.#loadArtwork(tree, "[data-field=\"cover-nowplaying\"]", tracklist, file);
        });
    }

    #loadArtwork(tree, selector, tracklist, file) {
        if (!file) {
            tree.querySelectorAll(selector).forEach((e) => {
                if (e.tagName == "IMG") {
                    e.setAttribute("src", "");
                } else {
                    e.style.backgroundImage = null;
                }
            });
        } else if (tree.querySelectorAll(selector)) {
            let img = tracklist.server.covers[file];
            if (!img) {
                tracklist.server.covers[file] = img = {off:0,buf:[]};
            }
            if (img.url) {
                tree.querySelectorAll(selector).forEach((e) => {
                    if (e.tagName == "IMG") {
                        e.setAttribute("src", img.url);
                    } else {
                        e.style.backgroundImage = img.url;
                    }
                });
            } else {
                let cb = (err, rx) => {
                    if (!err) {
                        for (let l of rx) {
                            if (l.key == "binary") {
                                img.buf.push(l.value);
                                img.off += l.value.byteLength;
                            } else if (l.key == "size") {
                                img[l.key] = l.value * 1;
                            } else if (l.key == "type") {
                                img[l.key] = l.value.toLowerCase();
                            } else {
                                img[l.key] = l.value;
                            }
                        }
                        if (img.off < img.size) {
                            ctx.tx("readpicture \"" + file + "\" " + img.off, cb);
                        } else {
                            if (!/^image\/[a-z]*$/.test(img.type)) {
                                img.type = "image/jpeg";
                            }
                            img.blob = new Blob(img.buf, {type: img.type});
                            img.url = URL.createObjectURL(img.blob);
                            tree.querySelectorAll(selector).forEach((e) => {
                                if (e.tagName == "IMG") {
                                    e.setAttribute("src", img.url);
                                } else {
                                    e.style.backgroundImage = img.url;
                                }
                            });
                        }
                    }
                };
                ctx.tx("readpicture \"" + file + "\" " + img.off, cb);
            }
        }
    }

}
