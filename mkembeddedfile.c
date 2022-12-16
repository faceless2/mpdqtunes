/* This program is used to embed arbitrary data into a C binary. It takes
 * a list of files as an input, and produces a .c data file that contains
 * contents of all these files as collection of char arrays.
 *
 * Usage: ./mkdata <this_file> <file1> [file2, ...] > embedded_data.c
 */

#include <stdlib.h>
#include <stdio.h>
#include <err.h>
#include <errno.h>
#include <string.h>

const char* header =
"#include <stddef.h>\n"
"#include <string.h>\n"
"#include <sys/types.h>\n"
"#include \"embeddedfile.h\"\n"
"\n"
"static const struct embeddedfile embeddedfiles[] = {\n";

const char* footer =
"  {NULL, NULL, NULL, 0}\n"
"};\n"
"\n"
"const struct embeddedfile *find_embedded_file(const char *name) {\n"
"  const struct embeddedfile *p;\n"
"  for (p = embeddedfiles; p->name != NULL; p++)\n"
"    if (!strcmp(p->name, name))\n"
"      return p;\n"
"  return NULL;\n"
"}\n";

static const char* get_mime(char* filename)
{
    const char *extension = strrchr(filename, '.');
    if(!strcmp(extension, ".js"))
        return "application/javascript";
    if(!strcmp(extension, ".css"))
        return "text/css";
    if(!strcmp(extension, ".woff"))
        return "font/woff";
    if(!strcmp(extension, ".otf"))
        return "font/otf";
    if(!strcmp(extension, ".svg"))
        return "image/svg+xml";
    if(!strcmp(extension, ".html"))
        return "text/html";
    if(!strcmp(extension, ".xht"))
        return "text/xht";
    return "text/plain";
}

int main(int argc, char *argv[])
{
    if (argc <= 1) {
        err(EXIT_FAILURE, "Usage: ./%s <this_file> <file1> [file2, ...] > embedded_data.c", argv[0]);
        exit(1);
    }

    for (int i = 1; i < argc; i++) {
        FILE *fd = fopen(argv[i], "r");
        if (!fd) {
            err(EXIT_FAILURE, "%s", argv[i]);
            exit(1);
        }
        printf("static const unsigned char v%d[] = {", i);
	int j = 0, buf;
        while((buf = fgetc(fd)) != EOF) {
            if(!(j % 12)) {
                putchar('\n');
            }
            printf(" %#04x, ", buf);
            j++;
        }
        printf(" 0x00\n};\n\n");
        fclose(fd);
    }
    fputs(header, stdout);

    for (int i = 1; i < argc; i++) {
        char *name = argv[i];   // eg "static/foo"
        while (*name != '/' && *name) {
            name++;
        }
        printf("  {\"%s\", v%d, \"%s\", sizeof(v%d) - 1}, \n", name, i, get_mime(name), i);
    }
    fputs(footer, stdout);
    return 0;
}
