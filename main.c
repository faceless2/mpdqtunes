#define _GNU_SOURCE
#include <sys/socket.h>
#include <poll.h>
#include <stdio.h>
#include "mongoose.h"
#ifdef AVAHI
#include <avahi-client/client.h>
#include <avahi-client/lookup.h>
#include <avahi-common/simple-watch.h>
#include <avahi-common/malloc.h>
#include <avahi-common/error.h>
#endif

//#define DEBUG 1

#define MAXLINE 512     // Max possible length of single line from MPD
#define TIMEOUT 50      // Seconds between ping

static char *bindaddr = "0.0.0.0";
static int port = 8000;
static char *rootdir = ".";

struct myhost {
  char name[100];
  char host[100];
  int port;
  struct myhost *next;
};

struct mycon {
  struct mg_connection *mgcon;
  int mpdfd;
  char buf[MAXLINE];
  char *binbuf;
  int off, binoff, binlen, pinged;
  time_t ping;
  struct mycon *next;
};

struct mycon *root = NULL;
struct myhost *hostroot = NULL;
#ifdef AVAHI
static AvahiSimplePoll *avahipoll = NULL;
#endif

int mpd_connect(struct mycon *con, const char *host, const int port) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    perror("socket");
    return 1;
  }

  struct addrinfo *addrinfo;
  if (getaddrinfo(host, NULL, NULL, &addrinfo)) {
    perror("geraddrinfo");
    return 1;
  }
  struct sockaddr_in *addr = NULL;
  for (struct addrinfo *r=addrinfo;r;r=r->ai_next) {
    char address[INET6_ADDRSTRLEN];
    if (r->ai_family == AF_INET) {
      if (!inet_ntop(AF_INET, &((struct sockaddr_in *)r->ai_addr)->sin_addr, address, sizeof(address))) {
        perror("inet_ntop");
        freeaddrinfo(addrinfo);
        return 1;
      } else {
        addr = calloc(sizeof(struct sockaddr_in), 1);
        addr->sin_family = AF_INET;
        addr->sin_port = htons(port);
        if (inet_pton(AF_INET, address, &addr->sin_addr) < 0) {
          perror("inet_pton");
          freeaddrinfo(addrinfo);
          free(addr);
          return 1;
        }
      }
      break;
    }
  }
  freeaddrinfo(addrinfo);
  if (!addr) {
    fprintf(stderr, "can't resolve \"%s\"", host);
    return 1;
  }
  if (connect(fd, (struct sockaddr *)addr, sizeof(struct sockaddr_in)) < 0) {
    perror("connect");
    return 1;
  }
  free(addr);
  int optval = 1;
  if (setsockopt(fd, SOL_SOCKET, SO_KEEPALIVE, &optval, sizeof(optval))) {
    perror("setsockopt");
  }
  con->mpdfd = fd;
  con->ping = time(NULL);
  return 0;
}

int mpd_disconnect(struct mycon *mycon) {
  if (mycon->mpdfd > 0) {
    close(mycon->mpdfd);
    mycon->mpdfd = 0;
  }
  return 0;
}

int mpd_send(struct mycon *mycon, char *buf, int len) {
  if (!strcmp(buf, "proxy-listservers")) {
    for (struct myhost *h = hostroot;h;h=h->next) {
      mg_ws_printf(mycon->mgcon, WEBSOCKET_OP_TEXT, "name: %s\n", h->name);
      mg_ws_printf(mycon->mgcon, WEBSOCKET_OP_TEXT, "host: %s\n", h->host);
      mg_ws_printf(mycon->mgcon, WEBSOCKET_OP_TEXT, "port: %d\n", h->port);
    }
    mg_ws_printf(mycon->mgcon, WEBSOCKET_OP_TEXT, "OK\n");
  } else if (!strncmp(buf, "proxy-connect ", 14) && (buf[14] == '"' || buf[14] == '\'') && buf[len-1] == buf[14]) {
    char *name = buf + 15;
    buf[len - 1] = 0;
    for (struct myhost *h = hostroot;h;h=h->next) {
      if (!strcmp(name, h->name)) {
        mpd_disconnect(mycon);
        if (mpd_connect(mycon, h->host, h->port)) {
          mg_ws_printf(mycon->mgcon, WEBSOCKET_OP_TEXT, "ACK [0@0] {proxy-connect} connection to name \"%s\" host \"%s\" port %d failed: %s\n", h->name, h->host, h->port, strerror(errno));
          mpd_disconnect(mycon);
        }
        name = NULL;
        break;
      }
    }
    if (name) {
      mg_ws_printf(mycon->mgcon, WEBSOCKET_OP_TEXT, "ACK [0@0] {proxy-connect} no server name \"%s\"\n", name);
    }
  } else if (!mycon->mpdfd) {
    int oldv = buf[len];
    buf[len] = 0;
    mg_ws_printf(mycon->mgcon, WEBSOCKET_OP_TEXT, "ACK [0@0] {%s} disconnected\n", buf);
    buf[len] = oldv;
  } else {
    int oldv = buf[len];
#if DEBUG
    printf("TX \"%s\"\n", buf);
#endif
    buf[len] = '\n';
    if (write(mycon->mpdfd, buf, len + 1) != len + 1) {
      perror("write");
      mpd_disconnect(mycon);
      return 1;
    }
    mycon->ping = time(NULL);
    buf[len] = oldv;
    return 0;
  }
  return 1;
}
/**
 * Read from the connection and if it's a full line
 * (or full binary bloc), send it to the websocket
 */
void mpd_poll(struct mycon *mycon) {
  if (!mycon->mpdfd) {
    return;
  }
  static char buf[256];
  memset(buf, 0, sizeof(buf));
  int len = read(mycon->mpdfd, buf, sizeof(buf) - 1);

  if (len < 0) {
    mpd_disconnect(mycon);
    perror("read");
  } else if (len > 0) {
#if DEBUG
    printf("RX \"%s\"\n", buf);
#endif
    mycon->ping = time(NULL);
    for (int i=0;i<len;i++) {
      char c = buf[i];
      if (mycon->binbuf) {
        // Reading a binary message
        mycon->binbuf[mycon->binoff++] = c;
        if (mycon->binoff == mycon->binlen) { 
          mg_ws_send(mycon->mgcon, mycon->binbuf, mycon->binlen, WEBSOCKET_OP_BINARY);
          free(mycon->binbuf);
          mycon->binbuf = NULL;
          mycon->binoff = mycon->binlen = 0;
        }
      } else {
        // Reading a text message
        mycon->buf[mycon->off++] = c;
        if (c == '\n' || mycon->off == sizeof(mycon->buf)) {
          mycon->buf[mycon->off - 1] = 0;
          if (!memcmp(mycon->buf, "binary: ", 8)) {
            // Read "binary: n" - if n is a positive number,
            // don't send that line but prepare for n-byte of binary data
            char *t = mycon->buf + 8;
            char *t2;
            int val = strtol(t, &t2, 10);
            if (val > 0 && !*t2) {
              mycon->binbuf = calloc(val, 1);
              mycon->binoff = 0;
              mycon->binlen = val;
            }
          }
          if (!mycon->binbuf) {
            // Full line other than "binary: n" - send it
            if (mycon->pinged) {
              // keep quiet about OK in response tp ping
              mycon->pinged = 0;
            } else {
              mg_ws_send(mycon->mgcon, mycon->buf, mycon->off - 1, WEBSOCKET_OP_TEXT);
            }
            mycon->off = 0;
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

#ifdef AVAHI
static void avahiResolveCallback(AvahiServiceResolver *r, AVAHI_GCC_UNUSED AvahiIfIndex interface, AVAHI_GCC_UNUSED AvahiProtocol protocol, AvahiResolverEvent event, const char *name, const char *type, const char *domain, const char *host_name, const AvahiAddress *address __attribute__((unused)), uint16_t port, AvahiStringList *txt __attribute__((unused)), AvahiLookupResultFlags flags __attribute__((unused)), AVAHI_GCC_UNUSED void* userdata) {
  if (event == AVAHI_RESOLVER_FAILURE) {
    fprintf(stderr, "Avahi Resolver: Failed to resolve service '%s' of type '%s' in domain '%s': %s\n", name, type, domain, avahi_strerror(avahi_client_errno(avahi_service_resolver_get_client(r))));
  } else if (event == AVAHI_RESOLVER_FOUND) {
    for (struct myhost *h=hostroot;h;h=h->next) {
      if (!strcmp(h->name, name) && !strcmp(h->host, host_name) && h->port == port) {
        name = NULL;
        break;
      }
    }
    if (name) {
#if DEBUG
      printf("Avahi: add name \"%s\" host \"%s\" port %d\n", name, host_name, port);
#endif      
      struct myhost *host = calloc(sizeof(struct myhost), 1);
      strncpy(host->name, name, sizeof(host->name));
      strncpy(host->host, host_name, sizeof(host->host));
      host->port = port;
      host->next = hostroot;
      hostroot = host;
    }
  }
  avahi_service_resolver_free(r);
}

static void avahiBrowseCallback(AvahiServiceBrowser *b, AvahiIfIndex interface, AvahiProtocol protocol, AvahiBrowserEvent event, const char *name, const char *type, const char *domain, AVAHI_GCC_UNUSED AvahiLookupResultFlags flags, void* userdata) {
  AvahiClient *c = userdata;
  if (event == AVAHI_BROWSER_FAILURE) {
    fprintf(stderr, "Avahi Browser: %s\n", avahi_strerror(avahi_client_errno(avahi_service_browser_get_client(b))));
    avahi_simple_poll_quit(avahipoll);
    avahipoll = NULL;
  } else if (event == AVAHI_BROWSER_NEW) {
    if (!(avahi_service_resolver_new(c, interface, protocol, name, type, domain, AVAHI_PROTO_UNSPEC, 0, avahiResolveCallback, c))) {
      fprintf(stderr, "Failed to resolve service '%s': %s\n", name, avahi_strerror(avahi_client_errno(c)));
    }
  } else if (event == AVAHI_BROWSER_REMOVE) {
#if DEBUG
    printf("Avahi: remove name \"%s\"n", name);
#endif      
    // Probably only one, but remove all just in case
    struct myhost *prev = NULL, *next = NULL;
    for (struct myhost *h=hostroot;h;h=next) {
      next = h->next;
      if (!strcmp(h->name, name)) {
        if (!prev) {
          hostroot = h->next;
          free(h);
        } else {
          prev->next = h->next;
        }
      }
    }
  }
}

static void avahiClientCallback(AvahiClient *c, AvahiClientState state, AVAHI_GCC_UNUSED void * userdata) {
  if (state == AVAHI_CLIENT_FAILURE) {
    fprintf(stderr, "Avahi: server connection failure: %s\n", avahi_strerror(avahi_client_errno(c)));
    avahi_simple_poll_quit(avahipoll);
    avahipoll = NULL;
  }
}
#endif


int main(int argc, char **argv) {
  int mpdport = 6600;
  char *mpdname = "MPD";
#ifdef AVAHI
  avahipoll = avahi_simple_poll_new();
#endif

  for (int i=1;i<argc;i++) {
    if (i + 1 < argc && (!strcmp("-H", argv[i]) || !strcmp("--mpd-host", argv[i]))) {
       struct myhost *h = calloc(sizeof(struct myhost), 1);
       strncpy(h->name, mpdname, sizeof(h->name));
       strncpy(h->host, argv[++i], sizeof(h->host));
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
#ifdef AVAHI
    } else if (!strcmp("--no-zeroconf", argv[i])) {
       avahipoll = NULL;
#endif
    } else {
       printf("Usage: %s [-H|--mpd-host <hostname>] [-P|--mpd-port <port>]\n", argv[0]);
       printf("              [-N|--mpd-name <string>] [-b|--bind <localaddress>]\n");
       printf("              [-p|--port <port>] [-r|--root <directory>]\n");
#ifdef AVAHI
       printf("              [--no-zeroconf]\n");
#endif
       printf("\n");
       printf("  Proxy one or more MPD servers to a Websocket connection\n");
       printf("       --mpd-host <hostname>        add a name or address of the MPD server\n");
       printf("       --mpd-port <port>            port of the MPD server. Must be specified before mpd-host  (default: 6600)\n");
       printf("       --mpd-name <string>          friendly-name of the MPD server. Must be specified before mpd-host (default: \"MDP\")\n");
       printf("       --port <port>                port to bind the webserver to (default: 8000)\n");
       printf("       --bind <localaddress>        local address to bind the webserver to (default: 0.0.0.0)\n");
       printf("       --root <directory>           directory to serve static HTTP files from (default: .)\n");
#ifdef AVAHI
       printf("       --no-zeroconf                don't use Zeroconf to find hosts\n");
#endif
       printf("\n");
       printf("  Connect to websocket at path \"/ws\" then send text message of \"proxy-listservers\" to list all MPD\n");
       printf("  servers (specified at runtime or found by Zeroconf). Then \"proxy-connect 'name'\" where \"name\" is the\n");
       printf("  name reported by proxy-listservers. Once connected, communication is direct with the MPD server.\n");
       printf("  Issue \"proxy-connect\" again to disconnect and reconnect to a new server. Final disconnection is when\n");
       printf("  the websocket connection is closed\n");
       printf("\n");
       printf("\n");
       exit(1);
    }
  }
  char *ws_listen;
  asprintf(&ws_listen, "ws://%s:%d", bindaddr, port);
  struct mg_mgr mgr;
  mg_mgr_init(&mgr);
#ifdef AVAHI
  AvahiClient *client = NULL;
  AvahiServiceBrowser *sb = NULL;
  int avahierr;
  if (avahipoll) {
    client = avahi_client_new(avahi_simple_poll_get(avahipoll), 0, avahiClientCallback, NULL, &avahierr);
    if (client) {
      sb = avahi_service_browser_new(client, AVAHI_IF_UNSPEC, AVAHI_PROTO_UNSPEC, "_mpd._tcp", NULL, 0, avahiBrowseCallback, client);
      if (!sb) {
        fprintf(stderr, "Avahi: failed to create service-browser: %s\n", avahi_strerror(avahi_client_errno(client)));
        avahipoll = NULL;
      }
    } else {
      fprintf(stderr, "Avahi: failed to create client: %s\n", avahi_strerror(avahierr));
      avahipoll = NULL;
    }
  }
#endif
  printf("Listening at ws://%s:%d/ws\n", bindaddr, port);
  mg_http_listen(&mgr, ws_listen, fn, NULL);

  // Event loop
  struct pollfd *pollfds = NULL;
  int fdcount = 0;
  for (;;) {
#ifdef AVAHI
    if (avahipoll) {
      avahi_simple_poll_iterate(avahipoll, 0);
    }
#endif
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
  return 0;
}
