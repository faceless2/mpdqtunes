"use strict";

let ctx;
let mouseData = {};

function mouseHandler(e) {
    let type = e.type;
    if (e.target && (e.target.tagName == "SELECT" || e.target.tagName == "INPUT")) {
        return;
    }
    if (type == "touchstart" || type == "touchend") {
        // This will prevent dblclick-to-zoom on iOS but will also destroy
        // any click/dblclick events. So we have to recreate those manually
        // below from the touch events. Done at end of this method.
        e.preventDefault();
        return;
    }

    if (type == "dblclick") {
        for (let elt of document.elementsFromPoint(e.clientX, e.clientY)) {
            if (elt.classList.contains("tr")) {
                let trackList = elt.parentNode.trackList;
                if (trackList.action) {
                    trackList.action(elt, e.shiftKey);
                }
                break;
            }
        }
        e.preventDefault();
        
    } else if (type == "pointerdown") {
        let alt = e.shiftKey || (e.pointerType == "touch" && !e.isPrimary);
        for (let elt of document.elementsFromPoint(e.clientX, e.clientY)) {
            if (elt.classList.contains("column-resize")) {
                // Begin a column-resize action in a table
                mouseData.action = "column-resize";
                mouseData.dragElement = elt;
                mouseData.dragElement.classList.add("selected");
                mouseData.dragPosition = { x: e.pageX, y: e.pageY };
                mouseData.column = elt.getAttribute("data-column");
                mouseData.trackList = elt.parentNode.parentNode.trackList;
                break;
            } else if (elt.classList.contains("tr") && !elt.classList.contains("thead")) {
                // Begin a track-drag action in a table
                mouseData.action = "track-drag";
                mouseData.dragElement = elt;
                mouseData.dragPosition = { x: e.pageX, y: e.pageY };
                mouseData.trackList = elt.parentNode.trackList;
                let newSelectEnd;
                if (alt && mouseData.trackList.getSelection()) {
                    mouseData.trackList.select(mouseData.trackList.getSelection().start, elt);
                } else {
                    mouseData.trackList.select(elt, elt);
                }
                let drag = document.getElementById("drag");
                while (drag.lastChild) {
                    drag.lastChild.remove();
                }
                drag.append(document.createTextNode(Math.abs(mouseData.trackList.getSelection().start.row - mouseData.trackList.getSelection().end.row) + 1));
                break;
            } else if (elt.classList.contains("th") && elt.parentNode.classList.contains("thead")) {
                // Begin a drag to reorder columns
                mouseData.action = "column-order";
                mouseData.dragElement = elt;
                mouseData.dragPosition = { x: e.pageX, y: e.pageY };
                mouseData.trackList = elt.parentNode.parentNode.trackList;
                mouseData.originalLeft = window.getComputedStyle(elt, null).left;
                mouseData.dragElement.classList.add("selected");
                break;
            } else if (elt.classList.contains("popup") || elt.classList.contains("table-menu")) {
                break;
            }
        }
        if (mouseData.action) {
            let stylesheet = document.querySelector("style[data-for=\"mouse\"]");
            if (!stylesheet) {
                stylesheet = document.createElement("style");
                stylesheet.setAttribute("data-for", "mouse");
                document.head.appendChild(stylesheet);
            }
            document.head.appendChild(stylesheet);
            mouseData.stylesheet = stylesheet;
            mouseData.server = mouseData.trackList ? mouseData.trackList.server : null;
        }

    } else if (type == "pointermove" && mouseData.action == "column-resize") {
        // in-progress column resize
        let diff = e.pageX - mouseData.dragPosition.x;
        if (mouseData.trackList) {
            mouseData.dragPosition = { x: e.pageX, y: e.pageY };
            mouseData.trackList.resize(mouseData.column, diff);
        } else if (mouseData.dragElement.previousElementSibling) {
            let prev = mouseData.dragElement.previousElementSibling;
            prev.style.width = null;
            let style = getComputedStyle(prev, null);
            prev.style.width = "calc(" + style.width + " + " + diff + "px)";
        }

    } else if (type == "pointermove" && mouseData.action == "column-order") {
        // in-progress column reorder
        let diff = e.pageX - mouseData.dragPosition.x;
        mouseData.dragElement.style.left = "calc(" + mouseData.originalLeft + " + " + diff + "px)";
        if (mouseData.dropTarget) {
            mouseData.dropTarget.classList.remove("drop-target");
        }
        for (let elt of document.elementsFromPoint(e.clientX, mouseData.dragPosition.y)) {
            if (elt.classList.contains("th") && elt != mouseData.dragElement) {
                mouseData.dropTarget = elt;
                mouseData.dropTarget.classList.add("drop-target");
            }
        }

    } else if (type == "pointermove" && mouseData.action == "track-drag") {
        // in-progress trag dragging
        let drag = document.getElementById("drag");
        document.documentElement.classList.add("track-dragging");
        drag.classList.remove("hidden");
        drag.style.left = Math.round(e.pageX - drag.getBoundingClientRect().width / 2) + "px";
        drag.style.top = Math.round(e.pageY - drag.getBoundingClientRect().height / 2) + "px";
        if (mouseData.trackList.reorder) {
            document.getElementById("bin").classList.remove("hidden");
        }
        let dropTarget = null;
        let seentr = false;
        for (let elt of document.elementsFromPoint(e.clientX, e.clientY)) {
            if (mouseData.trackList.reorder && elt == document.getElementById("bin")) {
                // reordering, dragged over the bin
                dropTarget = elt;
                break;
            } else if (mouseData.trackList.reorder && elt.classList.contains("tr") && !elt.classList.contains("thead") && elt != mouseData.dragElement) {
                // reordering, dragged over a row that is not in the header and not the current row
                dropTarget = elt;
                break;
            } else if (elt.trackList && elt.trackList != mouseData.trackList && elt.trackList.append) {
                // reordering, dragged over an element that represents a tracklist
                dropTarget = elt;
            } else if (elt.getAttribute("data-action") == "newplaylist") {
                // reordering, dragged over an element that creates a new playlist
                dropTarget = elt;
            } else if (mouseData.trackList.reorder && elt.classList.contains("tr")) {
                seentr = true;
            } else if (mouseData.trackList.reorder && elt.classList.contains("table") && !seentr) {
                // dragged to table with no intervening rows - dragged to space at bottom of table to add at end
                dropTarget = elt;
            }
        }
        if (mouseData.dropTarget && mouseData.dropTarget != dropTarget) {
            mouseData.dropTarget.classList.remove("drop-target");
            delete mouseData.dropTarget;
        }
        if (dropTarget && mouseData.dropTarget != dropTarget) {
            dropTarget.classList.add("drop-target");
            mouseData.dropTarget = dropTarget;
        }

    } else if (type == "pointerup" && mouseData.action == "column-resize") {
        // column-resize finished
        mouseData.dragElement.classList.remove("selected");
        if (!mouseData.trackList && mouseData.dragElement.previousElementSibling) {
            let prev = mouseData.dragElement.previousElementSibling;
            if (prev.id) {
                let style = getComputedStyle(prev, null);
                if (!ctx.preferences.columnResize) {
                    ctx.preferences.columnResize = {};
                }
                ctx.preferences.columnResize[prev.id] = style.width.toString();
                ctx.savePreferences();
            }
            for (let tracklist of ctx.getAllTrackLists()) {
                if (tracklist.active) {
                    tracklist.resize();
                } else if (tracklist.tracks) {
                    tracklist.pendingResize = true;
                }
            }
        }

    } else if (type == "pointerup" && mouseData.action == "column-order") {
        // column-order finished
        mouseData.dragElement.classList.remove("selected");
        mouseData.dragElement.style.left = null;
        if (mouseData.dropTarget) {
            let keys = Object.keys(mouseData.trackList.columns);
            let dragcol = mouseData.dragElement.getAttribute("data-column");
            let dropcol = mouseData.dropTarget.getAttribute("data-column");
            let ix = keys.indexOf(dropcol);
            keys.splice(keys.indexOf(dragcol), 1);
            keys.splice(ix, 0, dragcol);
            let tmp = JSON.parse(JSON.stringify(mouseData.trackList.columns));
            for (let col of keys) {
                delete mouseData.trackList.columns[col];
            }
            for (let col of keys) {
                mouseData.trackList.columns[col] = tmp[col];
            }
            mouseData.trackList.resize();
        }

    } else if (type == "pointerup" && mouseData.action == "track-drag" && mouseData.dropTarget && (mouseData.dropTarget.id == "bin" || mouseData.dropTarget.classList.contains("tr") || mouseData.dropTarget.classList.contains("table"))) {
        // Drop to reorder or delete
        let selection = mouseData.trackList.getSelection();
        let start = Math.min(selection.start.row, selection.end.row);
        let end = Math.max(selection.start.row, selection.end.row);
        if (mouseData.dropTarget.id == "bin") {
            mouseData.trackList.reorder(start, (end + 1) - start, null);
        } else if (mouseData.dropTarget.classList.contains("table")) {
            let to = mouseData.dropTarget.lastElementChild.row + 1;
            mouseData.trackList.reorder(start, (end + 1) - start, to);
        } else {
            let to = mouseData.dropTarget.row;
            mouseData.trackList.reorder(start, (end + 1) - start, to);
        }
        mouseData.trackList.select(null, null);

    } else if (type == "pointerup" && mouseData.action == "track-drag" && mouseData.dropTarget && (mouseData.dropTarget.getAttribute("data-action") == "newplaylist" || (mouseData.dropTarget.trackList && mouseData.dropTarget.trackList.append))) {
        // Drop onto playlist
        let selection = mouseData.trackList.getSelection();
        let start = Math.min(selection.start.row, selection.end.row);
        let end = Math.max(selection.start.row, selection.end.row);
        let files = [];
        while (start <= end) {
           files.push(mouseData.trackList.tracks[start++].file);
        }
        if (mouseData.dropTarget.getAttribute("data-action") == "newplaylist") {
            // Drop onto "new playlist" action
            let name = mouseData.trackList.nameNewPlaylistFromSelection();
            for (let p of mouseData.server.playlists) {
                if (p.name == name) {
                    let found = true;
                    for (let ix=2;found;ix++) {
                        found = false;
                        for (let p of mouseData.server.playlists) {
                            if (p.name == name) {
                                found = true;
                                break;
                            }
                        }
                    }
                    break;
                }
            }
            mouseData.server.createPlaylist(name, files, Object.assign({}, mouseData.trackList.columns));
        } else {
            // Drop onto existing playlist
            let alt = e.shiftKey;
            mouseData.dropTarget.trackList.append(files, alt ? 0 : null);
            mouseData.trackList.select(null, null);
        }
    }

    if (mouseData.action && (type == "pointerup" || type == "pointercancel")) {
        // Cleanup after mouse released
        if (mouseData.timerFunction) {
            clearTimeout(mouseData.timerFunction);
        }
        if (mouseData.action) {
            mouseData.stylesheet.innerHTML = "";
            if (mouseData.dropTarget) {
                mouseData.dropTarget.classList.remove("drop-target");
            }
        }
        if (type == "pointercancel") {
            if (mouseData.trackList) {
                mouseData.trackList.select(null, null);
            }
            if (mouseData.dragElement) {
                mouseData.dragElement.classList.remove("selected");
                mouseData.dragElement.style.left = null;
            }
        }
        document.documentElement.classList.remove("track-dragging");
        document.documentElement.classList.remove("nonscrolling");
        document.getElementById("bin").classList.add("hidden");
        document.getElementById("drag").classList.add("hidden");
        for (let key in mouseData) {
            if (key != "click") {
                delete mouseData[key];
            }
        }
    }

    if (e.pointerType == "touch") {
        // Have to recreate click/dblclick events
        // Must be done after the others
        let cancel = false;
        if (type == "pointercancel" || type == "pointermove") {
            cancel = true;
        } else if (type == "pointerdown" || type == "pointerup") {
            if (type == "pointerdown") {
                if (!mouseData.click) {
                    mouseData.click = {target: e.target, count: 0};
                }
                if (e.target == mouseData.click.target) {
                    mouseData.click.down = Date.now();
                } else {
                    cancel = true;
                }
            } else if (mouseData.click) {
                e.target.dispatchEvent(new MouseEvent("click", e));
                if (++mouseData.click.count == 2) {
                    e.target.dispatchEvent(new MouseEvent("dblclick", e));
                }
            }
            if (mouseData.click) {
                if (mouseData.click.timer) {
                    clearTimeout(mouseData.click.timer);
                }
                mouseData.click.timer = setTimeout(()=> {
                    delete mouseData.click;
                }, 500);
            }
        }
        if (cancel && mouseData.click) {
            if (mouseData.click.timer) {
                clearTimeout(mouseData.click.timer);
            }
            delete mouseData.click;
        }
    }


}

function init() {
    ctx = new Context();
    ctx.tx("proxy-listservers", (err,rx) => {
        let server;
        for (let l of rx) {
            if (l.key == "name") {
                if (server) {
                    ctx.addServer(server);
                }
                server = { };
            }
            server[l.key] = l.value;
        }
        if (server) {
            ctx.addServer(server);
            ctx.activate(location.hash);
        }
    });
    document.documentElement.addEventListener("touchstart", mouseHandler);
    document.documentElement.addEventListener("touchend", mouseHandler);
    document.documentElement.addEventListener("pointerdown", mouseHandler);
    document.documentElement.addEventListener("pointerup", mouseHandler);
    document.documentElement.addEventListener("pointermove", mouseHandler);
    document.documentElement.addEventListener("pointercancel", mouseHandler);   // Called when pointer moves to scrolling
    document.documentElement.addEventListener("dblclick", mouseHandler);
    window.addEventListener("hashchange", (e) => {
        ctx.activate(location.hash);
    });
    window.addEventListener("resize", (e) => {
        for (let tracklist of ctx.getAllTrackLists()) {
            if (tracklist.active) {
                tracklist.resize();
            } else if (tracklist.tracks) {
                tracklist.pendingResize = true;
            }
        }
    });
}

document.addEventListener("DOMContentLoaded", init);
