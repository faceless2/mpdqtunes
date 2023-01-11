class Library extends TrackList {

    filter = "\"(any contains \\\"\\\")\"";
    #loading;

    constructor(opts) {
        opts.type = "library";
        super(opts);
        this.sortkey = this.preferences.sortkey || "album";
    }

    reload() {
        if (this.#loading) {
            return;
        }
        this.#loading = true;
        const that = this;
        ctx.tx(ctx.countcmd + " " + this.filter, (err, rx) => {
            if (err && ctx.countcmd == "searchcount") {
                // fall back to "count"
                ctx.countcmd = "count";
                this.#loading = false;
                this.reload();
                return;
            }
            for (let l of rx) {
                if (l.key == "songs") {
                    that.tracks = [];
                    that.tracks.length = l.value * 1;
                    this.#loading = false;
                    this.dispatchEvent(new Event("load"));
                    that.rebuild();
                }
            }
        });
    }

    sort(column, reverse) {
        if (column == "file") {
            return;     // Can't sort on file
        }
        this.sortkey = column;
        this.reverse = reverse;
        this.reload();
        this.preferences.sortkey = this.sortkey;
        this.preferences.reverse = this.reverse;
        ctx.savePreferences();
    }

    action(row, alt) {
        // normal: add at current position in playlist, then play it
        // alt: add to end of playlist
        if (alt) {
            this.server.activePartition.append( [ this.tracks[row.row].file ] );
        } else {
            let ix = this.server.activePartition.track || 0;
            this.server.activePartition.addEventListener("append", (e) => {
                this.server.activePartition.addEventListener("load", (e) => {
                    this.server.activePartition.play(ix);
                },{once:true});
            },{once:true});
            if (this.tracks[row.row] && this.tracks[row.row].file) {
                this.server.activePartition.append( [ this.tracks[row.row].file ], ix);
            }
        }
    }

    loader(start, len) {
        const that = this;
        let sortkey = that.sortkey;
        switch (sortkey) {
            case "album": sortkey = "albumsort"; break;
            case "artist": sortkey = "artistsort"; break;
            case "albumartist": sortkey = "albumartistsort"; break;
            case "title": sortkey = "title"; break;     // titlesort not set up for fallback in trunk
            case "track": sortkey = "track"; break;
            case "date": sortkey = "date"; break;
            case "genre": sortkey = "genre"; break;
            case "composer": sortkey = "composer"; break;       // not set up for fallback in trunk
            case "file": sortkey = "file"; break;
            case "disc": sortkey = "disc"; break;
            case "duration": sortkey = "duration"; break;
            case "time": sortkey = "time"; break;
        }
        if (that.reverse) {
            sortkey = "-" + sortkey;
        }
        ctx.tx("search " + this.filter + " sort " + sortkey + " window " + start + ":" + (start + len), (err, rx) => {
            let track;
            for (let l of rx) {
                if (l.key == "file") {
                    if (track) {
                        that.set(start++, track);
                    }
                    track = {};
                }
                track[l.key.toLowerCase()] = l.value;
            }
            if (track) {
                that.set(start++, track);
            }
        });
    }
}
