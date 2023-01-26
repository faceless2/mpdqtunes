class Playlist extends TrackList {

    #loading;

    constructor(opts) {
        opts.type = "playlist";
        super(opts);
    }

    activate(active) {
        super.activate(active);
    }

    reload() {
        if (this.#loading) {
            return;
        }
        this.#loading = true;
        const that = this;
        ctx.tx("listplaylistinfo \"" + ctx.esc(this.name) + "\"", (err, rx) => {
            let track;
            let tracks = [];
            for (let l of rx) {
                if (l.key == "file") {
                    if (track) {
                        tracks.push(track);
                    }
                    track = {};
                    track.index = tracks.length + 1;
                }
                track[l.key.toLowerCase()] = l.value;
            }
            if (track) {
                tracks.push(track);
            }
            that.tracks = tracks;
            tracks.sort((a,b)=> {
                return a.pos = b.pos;
            })
            this.#loading = false;
            this.dispatchEvent(new Event("load"));
            that.rebuild();
        });
    }

    reorder(start, len, to) {
        const that = this;
        if (to == null) {
            ctx.tx("playlistdelete \"" + ctx.esc(this.name) + "\" " + start + (len == 1 ? "" : ":" + (start + len)), (err, rx) => {
                that.reload();
            });
        } else {
            // actually this only works with single track.
            let cmd = [];
            if (to > start) {
                to--;
            }
            do {
               cmd.push("playlistmove \"" + ctx.esc(this.name) + "\" " + start + " " + to);
               if (to < start) {
                   start++;
                   to++;
               }
               len--;
            } while (len > 0);
            ctx.tx(cmd, (err, rx) => {
                that.reload();
            });
        }
    }

    append(files, index) {
        if (!this.tracks) {
            this.addEventListener("load", ()=> {
                this.append(files, index);
            }, {once:true});
        } else {
            let l = [];
            let i = typeof(index) == "number" && index >= 0 && index <= this.tracks.length ? index : this.tracks.length;
            for (let f of files) {
                l.push("playlistadd \"" + ctx.esc(this.name) + "\" \"" + ctx.esc(f) + "\" " + i++);
            }
            ctx.tx(l, (err, r) => {
                this.dispatchEvent(new CustomEvent("append", {position:i-files.length, files:files}));
            });
        }
        this.reload();
    }

    sort(column, reverse) {
        let tmptracks = [...this.tracks];
        let newtracks = TrackList.localsort(tmptracks, column, reverse);
        let cmd = [];
        for (let newix=newtracks.length-1;newix>=0;newix--) {
            let oldix = tmptracks.indexOf(newtracks[newix]);
            cmd.push("playlistmove \"" + ctx.esc(this.name) + "\" " + oldix + " " + newix);
            tmptracks.splice(oldix, 1);
        }
        ctx.tx(cmd);
        this.sortkey = column;
        this.reverse = column != "index" && reverse;
        this.reload();
    }

    rename(name) {
        const that = this;
        if (typeof(name) == "string" && name.length && name != that.name) {
            ctx.tx("rename \"" + ctx.esc(this.name) + "\" \"" + ctx.esc(name) + "\"", (err, rx) => {
                if (!err) {
                    let oldid = that.id;
                    that.name = name;
                    that.postrename();
                    let newid = that.id;
                    document.querySelectorAll("a[href=\"#" + oldid + "\"]").forEach((e) => {
                        e.href = "#" + newid;
                        e.innerHTML = name;
                    });
                    document.querySelector("#" + oldid).id = newid;
                    document.querySelectorAll("[data-for=\"" + oldid + "\"]").forEach((e)=> {
                       e.setAttribute("data-for", newid);
                    });
                    that.pendingResize = true;          // Required
                    window.location = "#" + newid;
                }
            });
        }
    }

    destroy() {
        ctx.tx("rm \"" + ctx.esc(this.name) + "\"");
        ctx.preferences.delete[this.id];
        ctx.savePreferences();
        this.server.playlists.splice(this.server.playlists.indexOf(this), 1);;
        if (this.active) {
            ctx.activate(this.server.library.id);
        }
        document.querySelector("#" + this.id).remove();
        document.querySelector("style[data-for=\"" + this.id + "\"]").remove();
    }
}
