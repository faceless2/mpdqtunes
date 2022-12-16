class Partition extends TrackList {

    volume;
    mode;
    playstate;    // play, stop or pause
    track;
    random;
    replaygain;
    duration = 0;
    elapsed = 0;
    outputs;
    #timer;
    #loading;
    #playlistVersion;

    constructor(opts) {
        opts.type = "partition";
        super(opts);
    }

    activate(active) {
        ctx.tx("partition \"" + ctx.esc(this.name) + "\"");
        super.activate(active);
    }

    #updateTimer() {
        if (this.#timer) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
        if (this.playstate == "play") {
            const that = this;
            let start = Date.now() - this.elapsed;
            let t = function() {
                that.#timer = null;
                that.elapsed = Date.now() - start;
                that.dispatchEvent(new Event("elapsed"));
                that.elapsed = Date.now() - start;
                if (that.elapsed >= that.duration) {
                    that.reload();
                } else {
                    that.#timer = setTimeout(t, 1000 - (that.elapsed % 1000));
                }
            }
            that.elapsed = Date.now() - start;
            that.#timer = setTimeout(t, 1000 - (that.elapsed % 1000));
        }
    }

    reload() {
        if (this.#loading) {
            return;
        }
        this.#loading = true;
        let that = this;
        if (!this.outputs) {
            this.outputs = [];
            ctx.tx("outputs", (err,rx) => {
                this.outputs.length = 0;
                for (let l of rx) {
                    if (l.key == "outputid") {
                        this.outputs.push({});
                    } else {
                        this.outputs[this.outputs.length - 1][l.key] = l.value;
                    }
                }
                this.dispatchEvent(new Event("outputlist"));
            });
        }
        ctx.tx("replay_gain_status", (err,rx) => {
            for (let l of rx) {
                if (l.key == "replay_gain_mode") {
                    if (l.value != that.replaygain) {
                        that.replaygain = l.value;
                        that.dispatchEvent(new Event("replaygain"));
                    }
                }
            }
        });
        ctx.tx("status", (err,rx) => {
            let single = 0, repeat = false, random = false, playstate = null, elapsed = 0, duration = 0, volume = 0, playlistVersion = 0, playlistLength = 0, track = 0;
            for (let l of rx) {
                if (l.key == "volume") {
                    volume = l.value * 1;
                } else if (l.key == "repeat") {
                    repeat = l.value == "1";
                } else if (l.key == "single") {
                    single = l.value;
                } else if (l.key == "random") {
                    random = l.value == "1";
                } else if (l.key == "state") {
                    playstate = l.value;
                } else if (l.key == "song") {
                    track = l.value * 1;
                } else if (l.key == "elapsed") {
                    elapsed = Math.round(l.value * 1000);
                } else if (l.key == "duration") {
                    duration = Math.round(l.value * 1000);
                } else if (l.key == "playlist") {
                    playlistVersion = l.value * 1;
                } else if (l.key == "playlistlength") {
                    playlistLength = l.value * 1;
                }
            }
            if (volume != this.volume) {
                this.volume = volume;
                this.dispatchEvent(new Event("volume"));
            }
            if (random != this.random) {
                this.random = random;
                this.dispatchEvent(new Event("random"));
            }
            if (track != this.track || duration != this.duration) {
                if (this.rows && typeof(this.track) == "number" && this.track >= 0 && this.track < this.rows.length) {
                    this.rows[this.track].classList.remove("nowplaying");
                }
                that.track = track;
                if (this.rows && typeof(this.track) == "number" && this.track >= 0 && this.track < this.rows.length) {
                    this.rows[this.track].classList.add("nowplaying");
                }
                that.duration = duration;
                that.dispatchEvent(new Event("track"));
            }
            let mode;
            if (repeat && single == "1") {
                mode = "repeat-one";
            } else if (repeat && single == "0") {
                mode = "repeat-all";
            } else if (repeat && single == "oneshot") {
                mode = "repeat-oneshot";
            } else if (single == "1") {
                mode = "one";
            } else if (single == "0") {
                mode = "all";
            } else if (single == "oneshot") {
                mode = "oneshot";
            }
            if (mode != that.mode) {
                that.mode = mode;
                that.dispatchEvent(new Event("mode"));
            }
            if (playstate != that.playstate) {
                that.playstate = playstate;
                that.dispatchEvent(new Event("playing"));
            }
            if (elapsed != that.elapsed) {
                that.elapsed = elapsed;
                that.dispatchEvent(new Event("elapsed"));
            }
            if (playlistVersion != that.#playlistVersion) {
                ctx.tx("playlistinfo", (err, rx) => {
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
            } else {
                this.#loading = false;
                this.dispatchEvent(new Event("load"));
            }
            that.#updateTimer();
        });
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
                l.push("add \"" + ctx.esc(f) + "\" " + i++);
            }
            ctx.tx(l, (err, r) => {
                this.dispatchEvent(new CustomEvent("append", {position:i-files.length, files:files}));
            });
        }
        this.reload();
    }

    reorder(start, len, to) {
        const that = this;
        if (to == null) {
            ctx.tx("delete " + start + (len == 1 ? "" : ":" + (start + len)), (err, rx) => {
                that.reload();
            });
        } else {
            if (to >= start + len) {
                to -= len;
            }
            ctx.tx("move " + start + (len == 1 ? "" : ":" + (start + len)) + " " + to, (err, rx) => {
                that.reload();
            });
        }
    }

    action(row, alt) {
        ctx.tx("play " + row.row);
        this.reload();
    }

    skip(delta) {
        if (delta > 0) {
            ctx.tx("next");
            this.reload();
        } else if (delta < 0) {
            ctx.tx("previous");
            this.reload();
        }
    }

    setPosition(pos) {
        pos *= 1;
        if (pos >= 0 && pos <= this.duration) {
            ctx.tx("seek " + this.track + " " + (pos/1000), (err, rx) => {
                if (!err) {
                    this.elapsed = pos;
                    this.#updateTimer();
                }
            });
        }
    }

    setVolume(volume) {
        volume *= 1;
        if (volume >= 0 && volume <= 100) {
            volume = Math.round(volume);
            ctx.tx("setvol " + volume);
            if (volume != this.volume) {
                this.volume = volume;
                this.dispatchEvent(new Event("volume"));
            }
        }
    }

    /**
     * With no params, toggles play/pause
     * With boolean, play/pause the current track
     * With number, play the specified track
     */
    play(playing) {
        if (typeof(playing) == "number") {
            if (playing >= 0 && playing < this.tracks.length) {
                ctx.tx("play " + playing);
                this.reload();
            }
        } else {
            if (typeof(playing) != "boolean") {
                playing = this.playstate != "play";
            }
            if (playing) {
                ctx.tx("play");
                if (this.playstate != "play") {
                    this.playstate = "play";
                    this.dispatchEvent(new Event("playing"));
                    this.#updateTimer();
                }
            } else {
                ctx.tx("pause 1");
                if (this.playstate == "play") {
                    this.playstate = "pause";
                    this.dispatchEvent(new Event("playing"));
                    this.#updateTimer();
                }
            }
        }
    }

    setMode(mode) {
        console.log("M="+mode);
        const modes = [ "all", "repeat-all", "repeat-one", "repeat-oneshot", "one", "oneshot" ];
        if (modes.indexOf(mode) < 0) {
            if (this.mode == "all") {
                mode = "repeat-all";
            } else if (this.mode == "repeat-all") {
                mode = "repeat-one";
            } else {
                mode = "all";
            }
        }
        ctx.tx("repeat " + (mode.startsWith("repeat-") ? "1" : "0"));
        ctx.tx("single " + (mode.endsWith("all") ? "0" : mode.endsWith("one") ? "1" : "oneshot"));
        if (mode != this.mode) {
            this.mode = mode;
            this.dispatchEvent(new Event("mode"));
        }
    }

    setReplayGain(replaygain) {
        const gains = [ "none", "auto", "track", "album" ];
        if (gains.indexOf(replaygain) < 0) {
            if (this.replaygain == "auto") {
                replaygain = "none";
            } else {
                replaygain = "auto";
            }
        }
        ctx.tx("replay_gain_mode " + replaygain);
        if (replaygain != this.replaygain) {
            this.replaygain = replaygain;
            this.dispatchEvent(new Event("replaygain"));
        }
    }


    setRandom(random) {
        if (typeof(random) != "boolean") {
            random = !this.random;
        }
        ctx.tx("random " + (random ? "1" : "0"));
        if (random != this.random) {
            this.random = random;
            this.dispatchEvent(new Event("random"));
        }
    }

    sort(column, reverse) {
        let tmptracks = [...this.tracks];
        let newtracks = TrackList.localsort(tmptracks, column, reverse);
        let cmd = [];
        for (let newix=newtracks.length-1;newix>=0;newix--) {
            let oldix = tmptracks.indexOf(newtracks[newix]);
            cmd.push("move " + oldix + " " + newix);
            tmptracks.splice(oldix, 1);
        }
        ctx.tx(cmd);
        this.sortkey = column;
        this.reverse = column != "index" && reverse;
        this.reload();
    }

    destroy() {
        ctx.tx("delpartition \"" + ctx.esc(this.name) + "\"");
        this.server.partitions.splice(this.server.partitons.indexOf(this), 1);
        if (this.active) {
            ctx.activate(this.server.partitions[0].id);
        }
        document.querySelector("#" + this.id).remove();
        document.querySelector("style[data-for=\"" + this.id + "\"]").remove();
    }
}
