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
    #rowHeight;
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

    postrename() {
        let oldid = this.id;
        this.id = this.server.id + (this.type == "library" ? "_" : "_" + this.type + "_") + ctx.sanitize(this.name);
        if (this.id != oldid) {
            ctx.preferences[this.id] = this.preferences;
            delete ctx.preferences[oldid];
            ctx.savePreferences();
        }
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
        this.#offset = Math.floor(this.elt_table.scrollTop / this.#rowHeight);
        let start = this.#offset;
        let end = Math.min(this.tracks.length - 1, start + Math.ceil(this.elt_table.clientHeight / this.#rowHeight) - 1);;
//        console.log("update: start="+start+" end="+end+" tracks="+this.tracks.length+" rowh="+this.#rowHeight);

        // Traverse children, replacing spacers with rows whre required.
        // Start from the beginning unless "start" is already a row; then we can shortcut
        let y = 0;
        let e = this.elt_table.firstElementChild;;
        if (this.tracks[start] && this.tracks[start].row) {
            y = start;
            e = this.tracks[start].row;
        }
        for (;y <= end;e=e.nextElementSibling) {
            if (e.classList.contains("spacer")) {
                // it's a spacer;
                if (e.row != y) {
                    console.log(e);
                    throw new Error("expected " + y + " got " + e.row);
                } else if (y + e.length <= start) {
                    // spacer end is before start; no action
                    //console.log("y="+y+" spacer: "+e.row+".."+(e.row+e.length-1)+" skip");
                    y += e.length;
                } else if (y < start) {
                    // spacer start is before start; split spacer so new one starts at start
                    //console.log("y="+y+" spacer: "+e.row+".."+(e.row+e.length-1)+" split off first");
                    let spacer = document.createElement("div");
                    spacer.classList.add("spacer");
                    spacer.row = start;
                    spacer.length = e.row + e.length - start;
                    e.length = start - e.row;
                    e.style.height = BigInt(e.length * this.#rowHeight) + "px";
                    spacer.setAttribute("data-row", spacer.row);
                    spacer.setAttribute("data-length", spacer.length);
                    e.setAttribute("data-row", e.row);
                    e.setAttribute("data-length", e.length);
                    spacer.style.height = BigInt(spacer.length * this.#rowHeight) + "px";
                    this.elt_table.insertBefore(spacer, e.nextSibling);
                    y += e.length;
                } else if (y == e.row) {
                    // spacer starts at y and y is in range: trim by one row at top
                    //console.log("y="+y+" spacer: "+e.row+".."+(e.row+e.length-1)+" trim first");
                    let row = document.createElement("div");
                    row.classList.add("tr");
                    row.row = y;
                    row.setAttribute("data-row", row.row);
                    this.elt_table.insertBefore(row, e);
                    e.row++;
                    e.length--;
                    e.setAttribute("data-row", e.row);
                    e.setAttribute("data-length", e.length);
                    if (e.length === 0) {
                        e.remove();
                    } else {
                        e.style.height = BigInt(e.length * this.#rowHeight) + "px";
                    }
                    e = row;
                    if (this.tracks[y]) {
                        this.tracks[y].row = row;
                    }
                    y++;
                } else {
                    //console.log("y="+y+" spacer: "+e.row+".."+(e.row+e.length-1)+" other?");
                }
            } else if (typeof(e.row) == "number") {
                //console.log("y="+y+" row");
                if (this.tracks[y]) {
                    this.tracks[y].row = e;
                }
                y++;
            } else {
                //console.log("other");
            }
        }

        while (start <= end && this.tracks[start]) {
            if (this.tracks[start].row && !this.tracks[start].row.firstChild) {
                this.#redraw(start);
            }
            start++;
        }
        while (start <= end && this.tracks[end]) {
            if (this.tracks[end].row && !this.tracks[end].row.firstChild) {
                this.#redraw(end);
            }
            end--;
        }
        if (end >= start && this.loader) {
            this.loader(start, end - start + 1);
        }
    }

    getSelection() {
        return this.#selectStart ? {start: this.#selectStart, end: this.#selectEnd} : null;
    }

    select(start, end) {
        let inrange = false;
        for (let t of this.tracks) {
            let e = t ? t.row : null;
            if (!e) {
                // shouldn't happen
            } else if (!start) {
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
                        e.preventDefault();
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

                headerRow.appendChild(menu);
                this.elt_table.appendChild(headerRow);
            } else {
                headerRow = this.elt_table.querySelector(".tr.thead");
            }

            // Add headers
            while (headerRow.firstChild != headerRow.lastChild) {
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

            // Remove all rows
            let e2;
            for (let e=this.elt_table.lastChild;e;e=e2) {
                e2 = e.previousSibling;
                if (e.nodeType != Node.ELEMENT_NODE || typeof(e.row) == "number") {
                   e.remove();
                }
            }

            // Find height of row by adding temp, then removing it.
            let row = document.createElement("div");
            row.classList.add("tr");
            this.elt_table.appendChild(row);
            this.#rowHeight = row.offsetHeight;
            row.remove();

            // Add spacer
            let spacer = document.createElement("div");
            spacer.classList.add("spacer");
            spacer.row = 0;
            spacer.length = this.tracks.length;
            spacer.setAttribute("data-row", spacer.row);
            spacer.setAttribute("data-length", spacer.length);
            spacer.style.height = BigInt(spacer.length * this.#rowHeight) + "px";
            this.elt_table.appendChild(spacer);

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
        if (i > 0 && this.tracks[i - 1] && this.tracks[i - 1].row) {
            track.row = this.tracks[i - 1].row.nextElementSibling;
        } else {
            for (let e=this.elt_table.firstElementChild;e;e=e.nextElementSibling) {
                if (e.row === i) {
                    track.row = e;
                    break;
                }
            }
        }
        this.tracks[i] = track;
        this.#redraw(i);
        if (i === this.track) {
            track.row.classList.add("nowplaying");
        }
    }

    #redraw(i) {
        let track = this.tracks[i];
        if (track.row) {
            while (track.row.lastChild) {
                track.row.lastChild.remove();
            }
            for (let col in this.columns) {
                let cell = document.createElement("div");
                cell.classList.add("td");
                cell.classList.add(col.toLowerCase());
                if (track[col]) {
                    cell.appendChild(document.createTextNode(track[col]));
                }
                track.row.appendChild(cell);
            }
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
