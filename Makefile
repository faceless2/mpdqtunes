PROG = mpdwsproxy
#CFLAGS = -g
LIBS =

ifeq ($(shell pkg-config --exists avahi-client && echo 1),1)
  CFLAGS := ${CFLAGS} -DAVAHI $(shell pkg-config --cflags avahi-client)
  LIBS := ${LIBS} $(shell pkg-config --libs avahi-client)
endif

all: $(PROG)

$(PROG): main.c mongoose.c mongoose.h
	$(CC) mongoose.c main.c -Wall $(CFLAGS) $(LIBS) -o $(PROG)

clean:
	rm -rf $(PROG) *.o
