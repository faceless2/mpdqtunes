#define _GNU_SOURCE
#include <sys/socket.h>
#include <poll.h>
#include <stdio.h>
#include "mongoose.h"

//#define DEBUG 1

#define MAXLINE 512     // Max possible length of single line from MPD
#define TIMEOUT 50      // Seconds between ping

static char *bindaddr = "0.0.0.0";
static int port = 8000;
static char *rootdir = ".";

struct myhost {
  char *name;
  char *host;
  int port;
  struct myhost *next;
};

struct mycon {
  struct mg_connection *mgcon;
  struct myhost *host;
  int mpdfd;
  char buf[MAXLINE];
  char *binbuf;
  int off, binoff, binlen, pinged;
  time_t ping;
  struct mycon *next;
};

struct mycon *root = NULL;
struct myhost *hostroot = NULL;

int mpd_connect(struct mycon *con, const char *host, const int port, struct myhost *h) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    perror("socket");
    return 1;
  }
  struct sockaddr_in addr;
  memset(&addr, '0', sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons(port);
  if (inet_pton(AF_INET, host, &addr.sin_addr) < 0) {
    perror("inet_pton");
    return 1;
  }
  if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
    perror("connect");
    return 1;
  }
  int optval = 1;
  if (setsockopt(fd, SOL_SOCKET, SO_KEEPALIVE, &optval, sizeof(optval))) {
    perror("setsockopt");
  }
  con->mpdfd = fd;
  con->ping = time(NULL);
  con->host = h;
  return 0;
}

int mpd_disconnect(struct mycon *con) {
  if (con->mpdfd > 0) {
    close(con->mpdfd);
    con->mpdfd = 0;
    con->host = NULL;
  }
  return 0;
}

int mpd_send(struct mycon *con, char *buf, int len) {
  if (!strcmp(buf, "proxy-listservers")) {
    for (struct myhost *h = hostroot;h;h=h->next) {
      mg_ws_printf(con->mgcon, WEBSOCKET_OP_TEXT, "name: %s\n", h->name);
      mg_ws_printf(con->mgcon, WEBSOCKET_OP_TEXT, "host: %s\n", h->host);
      mg_ws_printf(con->mgcon, WEBSOCKET_OP_TEXT, "port: %d\n", h->port);
      mg_ws_printf(con->mgcon, WEBSOCKET_OP_TEXT, "OK\n");
    }
  } else if (!strncmp(buf, "proxy-connect ", 14) && (buf[14] == '"' || buf[14] == '\'') && buf[len-1] == buf[14]) {
    char *name = buf + 15;
    buf[len - 1] = 0;
    for (struct myhost *h = hostroot;h;h=h->next) {
      if (!strcmp(name, h->name)) {
        mpd_disconnect(con);
        if (mpd_connect(con, h->host, h->port, h)) {
          mg_ws_printf(con->mgcon, WEBSOCKET_OP_TEXT, "ACK [0@0] {proxy-connect} connection to name \"%s\" host \"%s\" port %d failed: %s\n", h->name, h->host, h->port, strerror(errno));
          mpd_disconnect(con);
        }
        name = NULL;
        break;
      }
    }
    if (name) {
      mg_ws_printf(con->mgcon, WEBSOCKET_OP_TEXT, "ACK [0@0] {proxy-connect} no server name \"%s\"\n", name);
    }
  } else if (!con->mpdfd) {
    int oldv = buf[len];
    buf[len] = 0;
    mg_ws_printf(con->mgcon, WEBSOCKET_OP_TEXT, "ACK [0@0] {%s} disconnected\n", buf);
    buf[len] = oldv;
  } else {
    int oldv = buf[len];
#if DEBUG
    printf("TX \"%s\"\n", buf);
#endif
    buf[len] = '\n';
    if (write(con->mpdfd, buf, len + 1) != len + 1) {
      perror("write");
      return 1;
    }
    con->ping = time(NULL);
    buf[len] = oldv;
    return 0;
  }
  return 1;
}
/**
 * Read from the connection and if it's a full line
 * (or full binary bloc), send it to the websocket
 */
void mpd_poll(struct mycon *con) {
  if (!con->mpdfd) {
    return;
  }
  static char buf[256];
  memset(buf, 0, sizeof(buf));
  int len = read(con->mpdfd, buf, sizeof(buf) - 1);

  if (len < 0) {
    perror("read");
  } else if (len > 0) {
#if DEBUG
    printf("RX \"%s\"\n", buf);
#endif
    con->ping = time(NULL);
    for (int i=0;i<len;i++) {
      char c = buf[i];
      if (con->binbuf) {
        // Reading a binary message
        con->binbuf[con->binoff++] = c;
        if (con->binoff == con->binlen) { 
          mg_ws_send(con->mgcon, con->binbuf, con->binlen, WEBSOCKET_OP_BINARY);
          free(con->binbuf);
          con->binbuf = NULL;
          con->binoff = con->binlen = 0;
        }
      } else {
        // Reading a text message
        con->buf[con->off++] = c;
        if (c == '\n' || con->off == sizeof(con->buf)) {
          con->buf[con->off - 1] = 0;
          if (!memcmp(con->buf, "binary: ", 8)) {
            // Read "binary: n" - if n is a positive number,
            // don't send that line but prepare for n-byte of binary data
            char *t = con->buf + 8;
            char *t2;
            int val = strtol(t, &t2, 10);
            if (val > 0 && !*t2) {
              con->binbuf = calloc(val, 1);
              con->binoff = 0;
              con->binlen = val;
            }
          }
          if (!con->binbuf) {
            // Full line other than "binary: n" - send it
            if (con->pinged) {
              // keep quiet about OK in response tp ping
              con->pinged = 0;
            } else {
              mg_ws_send(con->mgcon, con->buf, con->off - 1, WEBSOCKET_OP_TEXT);
            }
            con->off = 0;
          }
        }
      }
    }
  }
}

/**
 * Callback for Mongoose web-server event
 */
static void fn(struct mg_connection *mgcon, int ev, void *ev_data, void *fn_data  __attribute__((unused))) {
  if (ev == MG_EV_HTTP_MSG) {
    struct mg_http_message *hm = (struct mg_http_message *) ev_data;
    if (mg_http_match_uri(hm, "/ws")) {
      // Upgrade to websocket. From now on, a connection is a full-duplex
      // Websocket connection, which will receive MG_EV_WS_MSG events.
      mg_ws_upgrade(mgcon, hm, NULL);
    } else {
      // Serve static files
      struct mg_http_serve_opts opts = {.root_dir = rootdir};
      mg_http_serve_dir(mgcon, ev_data, &opts);
    }

  } else if (ev == MG_EV_WS_MSG) {
    // Got websocket frame.
    struct mg_ws_message *wm = (struct mg_ws_message *) ev_data;
    if ((wm->flags & 0xF) == WEBSOCKET_OP_TEXT) {
      // Find matching connection
      struct mycon *mycon;
      for (mycon=root;mycon;mycon=mycon->next) {
        if (mycon->mgcon == mgcon) {
          break;
        }
      }
      if (!mycon) {
        // Create new connection
        mycon = calloc(sizeof(struct mycon), 1);
        mycon->mgcon = mgcon;
        mycon->next = root;
        root = mycon;
      }
      if (mycon) {
        mpd_send(mycon, (char *)wm->data.ptr, wm->data.len);
      }
    }

  } else if (ev == MG_EV_CLOSE) {
    struct mycon *mycon, *prev = NULL;
    for (mycon=root;mycon;mycon=mycon->next) {
      if (mycon->mgcon == mgcon) {
        mpd_disconnect(mycon);
        if (prev) {
          prev->next = mycon->next;
        } else {
          root = mycon->next;
        }
        free(mycon);
        mycon = NULL;
        break;
      }
      prev = mycon;
    }
  }
}

int main(int argc, char **argv) {
  int mpdport = 6600;
  char *mpdname = "MDP";
#ifdef ZEROCONF
  bool zeroconf = true;
#endif
  for (int i=1;i<argc;i++) {
    if (i + 1 < argc && (!strcmp("-H", argv[i]) || !strcmp("--mpd-host", argv[i]))) {
       struct myhost *h = calloc(sizeof(struct myhost), 1);
       h->name = mpdname;
       h->host = strdup(argv[++i]);
       h->port = mpdport;
       if (!hostroot) {
         hostroot = h;
       } else {
         struct myhost *t = hostroot;
         while (t->next) {
           t = t->next;
         }
         t->next = h;
       }
    } else if (i + 1 < argc && (!strcmp("-N", argv[i]) || !strcmp("--mpd-name", argv[i]))) {
       mpdname = strdup(argv[++i]);
    } else if (i + 1 < argc && (!strcmp("-b", argv[i]) || !strcmp("--bind", argv[i]))) {
       bindaddr = strdup(argv[++i]);
    } else if (i + 1 < argc && (!strcmp("-r", argv[i]) || !strcmp("--root", argv[i]))) {
       rootdir = strdup(argv[++i]);
    } else if (i + 1 < argc && (!strcmp("-P", argv[i]) || !strcmp("--mpd-port", argv[i]))) {
       mpdport = atoi(argv[++i]);
    } else if (i + 1 < argc && (!strcmp("-p", argv[i]) || !strcmp("--port", argv[i]))) {
       port = atoi(argv[++i]);
#ifdef ZEROCONF
    } else if (!strcmp("--no-zeroconf", argv[i])) {
       zeroconf = false;
#endif
    } else {
       printf("Usage: %s [-H|--mpd-host <hostname>] [-P|--mpd-port <port>]\n", argv[0]);
       printf("              [-N|--mpd-name <string>] [-b|--bind <localaddress>]\n");
       printf("              [-p|--port <port>] [-r|--root <directory>]\n");
#ifdef ZEROCONF
       printf("              [--no-zeroconf]\n");
#endif
       printf("\n");
       printf("  Proxy an MPD server to a Websocket\n");
       printf("       --mpd-host <hostname>        add a name or address of the MPD server\n");
       printf("       --mpd-port <port>            port of the MPD server. Must be specified before mpd-host  (default: 6600)\n");
       printf("       --mpd-name <string>          friendly-name of the MPD server. Must be specified before mpd-host (default: \"MDP\")\n");
       printf("       --port <port>                port to bind the webserver to (default: 8000)\n");
       printf("       --bind <localaddress>        local address to bind the webserver to (default: 0.0.0.0)\n");
       printf("       --root <directory>           directory to serve static HTTP files from (default: .)\n");
#ifdef ZEROCONF
       printf("       --no-zeroconf                don't use Zeroconf to find hosts\n");
#endif
       printf("\n");
       exit(1);
    }
  }
  char *ws_listen;
  asprintf(&ws_listen, "ws://%s:%d", bindaddr, port);
  struct mg_mgr mgr;
  mg_mgr_init(&mgr);
  printf("Listening at ws://%s:%d/ws\n", bindaddr, port);
  mg_http_listen(&mgr, ws_listen, fn, NULL);

  // Event loop
  struct pollfd *pollfds;
  int fdcount = 0;
  for (;;) {
    mg_mgr_poll(&mgr, 200);
    time_t now = time(NULL);
    int t = 0;
    for (struct mycon *mycon=root;mycon;mycon=mycon->next) {
      t++;
      if (mycon->mpdfd && now - mycon->ping > TIMEOUT) {
        char tbuf[5];
        strcpy(tbuf, "ping");
        mycon->pinged = 1;
        mpd_send(mycon, tbuf, 5);
      }
    }
    if (t) {
      if (t > fdcount) {
        if (pollfds) {
          free(pollfds);
        }
        pollfds = calloc(t, sizeof(struct pollfd));
        fdcount = t;
      }
      t = 0;
      for (struct mycon *mycon=root;mycon;mycon=mycon->next) {
        pollfds[t].fd = mycon->mpdfd;
        pollfds[t].events = POLLIN;
        pollfds[t].revents = 0;
        t++;
      }
      if ((t=poll(pollfds, t, 200)) < 0) {
        perror("poll");
      } else if (t) {
        t = 0;
        for (struct mycon *mycon=root;mycon;mycon=mycon->next) {
          if (pollfds[t].revents) {
            mpd_poll(mycon);
          }
          t++;
        }
      }
    }
  }

  mg_mgr_free(&mgr);
  return 0;
}
