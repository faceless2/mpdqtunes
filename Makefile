PROG = mpdqtunes
EMBEDDEDFILES = $(shell find static -type f)

CFLAGS=
# Comment out next line to stop embedding content from the "static" directory
CFLAGS := ${CFLAGS} -DSERVESTATIC=1
CFLAGS := ${CFLAGS} -g
LIBS =

ifeq ($(shell pkg-config --exists avahi-client && echo 1),1)
  CFLAGS := ${CFLAGS} -DAVAHI $(shell pkg-config --cflags avahi-client)
  LIBS := ${LIBS} $(shell pkg-config --libs avahi-client)
endif

all: $(PROG)

$(PROG): main.c mongoose.c mongoose.h embeddedfile.c embeddedfile.h
	$(CC) mongoose.c main.c embeddedfile.c -Wall $(CFLAGS) $(LIBS) -o $(PROG)

embeddedfile.c: mkembeddedfile $(EMBEDDEDFILES)
	./mkembeddedfile $(EMBEDDEDFILES) > embeddedfile.c

mkembddedfile: mkembeddedfile.c embeddedfile.h

clean:
	rm -rf $(PROG) mkembeddedfile *.o embeddedfile.c
