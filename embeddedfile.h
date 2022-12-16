#ifndef EMBEDDEDFILE
#define EMBEDDEDFILE

struct embeddedfile {
  const char *name;
  const unsigned char *data;
  const char *mimetype;
  size_t size;
};

const struct embeddedfile *find_embedded_file(const char *name);

#endif
