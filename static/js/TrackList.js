/**
 * @param e the base element of the table
 * @param loader a function that takes (this, start, end) - loads tracks, calls set()
 */
class TrackList extends EventTarget {
    server;
    elt;
    elt_table;
    id;
    name;
    tracks;
    columns;
    sortkey;
    reverse;
    #offset = 0;
    #stylesheet;
    #selectStart;
    #selectEnd;
    #columnResizeWidth;
    rows;
    preferences;

    constructor(opts) {
        super();
        this.server = opts.server;
        this.name = opts.name;
        this.type = opts.type;
        this.id = this.server.id + (this.type == "library" ? "_" : "_" + this.type + "_") + ctx.sanitize(this.name);
        this.elt = opts.elt;
        this.elt.id = this.id;
        this.elt_table = opts.elt_table;
        this.elt_table.trackList = this;
        let sctimeout;
        const that = this;
        this.elt_table.classList.add("table");
        this.elt_table.addEventListener("scroll", function(e) {
            if (sctimeout) {
                clearTimeout(sctimeout);
            }
            sctimeout = setTimeout(()=>{that.#update()}, 400);
        });
        this.#stylesheet = document.createElement("style");
        this.#stylesheet.setAttribute("data-for", this.id);
        document.head.appendChild(this.#stylesheet);
        this.preferences = ctx.preferences[this.id];
        if (!this.preferences) {
            this.preferences = ctx.preferences[this.id] = {};
        }
        this.sortkey = this.preferences.sortkey || "index";
        this.reverse = this.preferences.reverse || false;
    }

    activate(active) {
        if (active) {
            if (!this.tracks) {
                this.tracks = [];
                this.reload();
            }
            if (!this.active) {
                this.dispatchEvent(new Event("activate"));
                this.active = active;
            }
            if (this.pendingRebuild) {
                this.rebuild();
                delete this.pendingRebuild;
            } else if (this.pendingResize) {
                this.resize();
                delete this.pendingSize;
            }
        } else {
            if (this.active) {
                this.dispatchEvent(new Event("deactivate"));
                this.active = active;
            }
            if (this.server.active == this) {
                this.server.active = null;
            }
        }
        document.querySelectorAll("#nav [data-for=\"" + this.id + "\"]").forEach((e) => {
            e.classList.toggle("selected", active);
        });
    }

    /**
     * Call on resize or scroll to display visible rows
     */
    #update() {
        let style = window.getComputedStyle(this.elt_table, null);
        let padding = (style.paddingTop.replace(/px/, "")*1) + (style.paddingBottom.replace(/px/, "")*1);
        let unitHeight = (this.elt_table.scrollHeight - padding) / this.tracks.length;
        this.#offset = Math.floor(this.elt_table.scrollTop / unitHeight);
        this.visible = Math.ceil(this.elt_table.clientHeight / unitHeight);
        let start = this.#offset;
        let len = this.visible;

        while (len && this.tracks[start]) {
            if (!this.rows[start].firstChild) {
                this.#redraw(start);
            }
            start++;
            len--;
        }
        while (len && this.tracks[start + len - 1]) {
            if (!this.rows[start + len - 1].firstChild) {
                this.#redraw(start + len);
            }
            len--;
        }
        if (len > 0 && this.loader) {
            this.loader(start, len);
        }
    }

    getSelection() {
        return this.#selectStart ? {start: this.#selectStart, end: this.#selectEnd} : null;
    }

    select(start, end) {
        let inrange = false;
        for (let e of this.rows) {
            if (!start) {
                e.classList.remove("selected");
            } else if (e == start) {
                if (e != end) {
                    inrange = !inrange;
                }
                e.classList.add("selected");
            } else if (e == end) {
                e.classList.add("selected");
                inrange = !inrange;
            } else if (e.classList) {
                e.classList.toggle("selected", inrange);
            }
        }
        this.#selectStart = start;
        this.#selectEnd = end;
        this.dispatchEvent(new Event("select"));
    }

    /**
     * Recreate the table, re-adding the header, creating the right
     * number of rows and readding any data we have. Call after
     * reordering columns or any sort of data rebuild. But we can
     * only do this if we're visible
     */
    rebuild() {
        if (this.active) {
            let headerRow;
            const initialize = this.columns == null;
            if (initialize) {
                this.columns = this.preferences.columns;
                if (!this.columns) {
                    this.columns = this.preferences.columns = {}
                    if (this.type != "library") {
                        this.columns["index"] = 40;
                    }
                    for (let col of ctx.defaultColumns) {
                        if (ctx.availableColumns[col]) {
                            this.columns[col] = 0;
                        }
                    }
                }
                headerRow = document.createElement("div");
                headerRow.classList.add("tr");
                headerRow.classList.add("thead");

                // Create popup menu to enable/disable columns
                let menu = document.createElement("div");
                menu.classList.add("table-menu");
                let popup = document.createElement("div");
                popup.classList.add("popup");
                popup.classList.add("hidden");
                menu.appendChild(popup);
                menu.addEventListener("click", (e) => {
                    popup.classList.toggle("hidden");
                });
                let that = this;
                for (let col in ctx.availableColumns) {
                    let a = document.createElement("a");
                    a.appendChild(document.createTextNode(ctx.availableColumns[col]));
                    a.classList.toggle("disabled", typeof(this.columns[col]) == "undefined");
                    a.addEventListener("click", (e) => {
                        if (typeof(this.columns[col]) == "undefined") {
                            this.columns[col] = 0;
                            e.target.classList.remove("disabled");
                        } else {
                            delete this.columns[col];
                            e.target.classList.add("disabled");
                        }
                        that.rebuild();
                        that.resize();
                    });
                    popup.appendChild(a);
                }

                this.elt_table.appendChild(menu);
                this.elt_table.appendChild(headerRow);
                this.rows = [];
            } else {
                headerRow = this.elt_table.querySelector(".tr.thead");
            }

            // Add headers
            while (headerRow.lastChild) {
                headerRow.removeChild(headerRow.lastChild);
            }
            let colArray = Object.keys(this.columns);
            for (let col in this.columns) {
                let cell = document.createElement("div");
                cell.classList.add("th");
                cell.classList.add(col);
                cell.setAttribute("data-column", col);
                cell.appendChild(document.createTextNode(ctx.availableColumns[col]));
                const that = this;
                if (this.sortkey == col) {
                    cell.classList.add("sort");
                    cell.classList.toggle("reverse", this.reverse);
                    cell.addEventListener("click", ()=> {
                        that.sort(col, !that.reverse);
                    });
                } else {
                    cell.addEventListener("click", ()=> {
                        that.sort(col, false);
                    });
                }
                headerRow.appendChild(cell);
                if (colArray.indexOf(col) + 1 < colArray.length) {
                    let resizeBar = document.createElement("div");
                    resizeBar.classList.add("column-resize");
                    resizeBar.setAttribute("data-column", col);
                    headerRow.appendChild(resizeBar);
                    if (!this.#columnResizeWidth) {
                        this.#columnResizeWidth = resizeBar.getBoundingClientRect().width;
                    }
                }
            }

            // Add correct number of rows
            while (this.rows.length > this.tracks.length) {
                this.rows[this.rows.length - 1].remove();
                this.rows.pop();
            }
            for (let i=0;i<this.rows.length;i++) {
                let row = this.rows[i];
                while (row.lastChild) {
                    row.removeChild(row.lastChild);
                }
            }
            while (this.rows.length < this.tracks.length) {
                let row = document.createElement("div");
                row.classList.add("tr");
                row.row = this.rows.length;
                this.elt_table.appendChild(row);
                this.rows.push(row);
            }
            if (typeof(this.track) == "number" && this.track >= 0 && this.track < this.rows.length) {
                this.rows[this.track].classList.add("nowplaying");
            }

            this.#update();
            if (initialize) {
                this.resize(null, null);
            }
        } else {
            this.pendingRebuild = true;
        }
    }

    /**
     * Set track "i" to the specified value. Adds to the current layout
     */
    set(i, track) {
        if (i < 0 || i >= this.tracks.length) {
            throw new Error("bad index " + i);
        }
        if (!track) {
            throw new Error("bad track");
        }
        this.tracks[i] = track;
        this.#redraw(i);
    }

    #redraw(i) {
        let track = this.tracks[i];
        let row = this.rows[i];
        while (row.lastChild) {
            row.lastChild.remove();
        }
        for (let col in this.columns) {
            let cell = document.createElement("div");
            cell.classList.add("td");
            cell.classList.add(col.toLowerCase());
            if (track[col]) {
                cell.appendChild(document.createTextNode(track[col]));
            }
            row.appendChild(cell);
        }
    }

    /**
     * Resize the columns. If "col" set, add "diff" to col, otherwise just make it fit available width
     */
    resize(col, diff) {
        const numColumns = Object.keys(this.columns).length;
        const availWidth = this.elt_table.getBoundingClientRect().width + this.elt_table.clientWidth - this.elt_table.offsetWidth;
        const minWidth = Math.min(availWidth / numColumns, 40);
        let currentWidth = 0;
        let i = 0;
        for (let c in this.columns) {
            if (this.columns[c] >= minWidth) {
                currentWidth += this.columns[c];
                i++;
            } else {
                this.columns[c] = 0;
            }
        }
        //console.log("resize0: cw="+currentWidth+" aw="+availWidth+" "+JSON.stringify(this.columns));
        if (i < numColumns) {
            let diff = availWidth / numColumns;
            for (let c in this.columns) {
                if (this.columns[c] == 0) {
                    this.columns[c] = diff;
                    currentWidth += this.columns[c];
                }
            }
        }
        //console.log("resize1: cw="+currentWidth+" aw="+availWidth+" "+JSON.stringify(this.columns));
        if (currentWidth - availWidth > 0.4) {
            // too wide. Trim columns > minwidth
            let leanWidth = numColumns * minWidth;
            let mul = (availWidth - leanWidth) / (currentWidth - leanWidth);
            currentWidth = 0;
            for (let c in this.columns) {
                let cfat = this.columns[c] - minWidth;
                this.columns[c] = minWidth + cfat * mul;
                currentWidth += this.columns[c];
            }
            //console.log("resize2w: cw="+currentWidth+" aw="+availWidth+" "+JSON.stringify(this.columns));
        } else if (currentWidth - availWidth < -0.4) {
            // too narrow. Widen all columns
            let diff = (availWidth - currentWidth) / numColumns;
            currentWidth = 0;
            for (let c in this.columns) {
                this.columns[c] += diff;
                currentWidth += this.columns[c];
            }
            //console.log("resize2n: cw="+currentWidth+" aw="+availWidth+" "+JSON.stringify(this.columns));
        }

        if (col && this.columns[col]) {
            currentWidth = 0;
            if (numColumns == 1) {
                this.columns[col] = availWidth;
            } else if (Math.abs(diff) > 0) {
                let otherdiff = -diff / (numColumns - 1);
                for (let c in this.columns) {
                    this.columns[c] = Math.max(minWidth, this.columns[c] + (c == col ? diff : otherdiff));
                    currentWidth += this.columns[c];
                }
                for (let c in this.columns) {
                    if (currentWidth > availWidth) {
                        let diff = Math.max(minWidth, this.columns[c] + availWidth - currentWidth) - this.columns[c];
                        this.columns[c] += diff;
                        currentWidth += diff;
                    }
                }
            }
        }
        let id = this.id;
        let style = "";
        let left = 0;
        for (let c in this.columns) {
            let width = Math.floor(this.columns[c]);
            style += "#" + this.id + " .table > * > ." + c + " { position: absolute; left: " + left + "px; width: " + width + "px }\n";
            left += width;
            style += "#" + this.id + " .table .column-resize[data-column=\"" + c + "\"] { left: " + (left - this.#columnResizeWidth * 0.5) + "px }\n";
        }
        this.#stylesheet.innerHTML = style;
        ctx.savePreferences();
    }

    static localsort(tracks, column, reverse) {
        let newtracks = [];
        for (let i=0;i<tracks.length;i++) {
            newtracks.push(tracks[i]);
        }
        let compare = (column,rev,tracks,a,b) => {
            if (column == "index") {
                return rev ? b.index - a.index : a.index - b.index;
            }
            let va = a[column] || (column == "albumartist" ? (a.artist || "") : "");
            let vb = b[column] || (column == "albumartist" ? (b.artist || "") : "");
            let v;
            if (column == "track" || column == "disc" || column == "duration" || column == "time" || column == "pos" || column == "id") {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
                v = va < vb ? -1 : va > vb ? 1 : 0;
            } else {
                if (va.toLowerCase().startsWith("The ")) {
                    va = va.substring(4) + ", The";
                }
                if (vb.toLowerCase().startsWith("The ")) {
                    vb = vb.substring(4) + ", The";
                }
                v = va.localeCompare(vb);
            }
            if (v != 0) {
                return rev ? -v : v;
            }
            if (v == 0 && column == "album") {
                v = compare("disc", false, tracks, a, b);
            } else if (v == 0 && column == "disc") {
                v = compare("track", false, tracks, a, b);
            } else if (v == 0) {
                v = tracks.indexOf(a) - tracks.indexOf(b);
            }
            return v;
        };
        newtracks.sort((a,b) => {
            return compare(column, reverse, tracks, a, b);
        });
        return newtracks;
    }

}
