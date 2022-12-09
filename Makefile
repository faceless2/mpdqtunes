PROG = mpdwsproxy

all: $(PROG)

$(PROG): main.c mongoose.c mongoose.h
	$(CC) mongoose.c main.c -W -Wall $(CFLAGS) -o $(PROG)

clean:
	rm -rf $(PROG) *.o
