/*
 * stdio.c: console input and output over the UART, and printf.
 *
 * printf, sprintf and snprintf share one formatter. It writes each character
 * through an Out: either to the UART, or into a buffer.
 */
#include <stdio.h>
#include <machine.h>

/* Send one byte: wait until the UART can take it, then write it. */
int putchar(int c)
{
    while ((mmio_read8(UART_LSR) & UART_LSR_THR_EMPTY) == 0) {
    }
    mmio_write8(UART_THR, c);
    return (unsigned char)c;
}

/* Print s and a newline. */
int puts(const char *s)
{
    while (*s != '\0') {
        putchar(*s);
        s++;
    }
    putchar('\n');
    return 0;
}

/* Wait for a byte from the UART and return it. */
int getchar(void)
{
    while ((mmio_read8(UART_LSR) & UART_LSR_DATA_READY) == 0) {
    }
    return mmio_read8(UART_RBR);
}

/* Where formatted text goes. */
typedef struct {
    char *buf;   /* the buffer, or NULL to print on the UART */
    size_t size; /* room in buf, counting the final '\0' */
    size_t len;  /* characters produced so far (even ones that did not fit) */
} Out;

static void out_char(Out *out, int c)
{
    if (out->buf == NULL)
        putchar(c);
    else if (out->len + 1 < out->size)
        out->buf[out->len] = (char)c;
    out->len++;
}

static void out_repeat(Out *out, int c, int count)
{
    while (count > 0) {
        out_char(out, c);
        count--;
    }
}

/* How one conversion (the part after a %) asked to be printed. */
typedef struct {
    int left;      /* '-': pad on the right */
    int zero;      /* '0': pad numbers with zeros */
    int width;     /* minimum field width */
    int precision; /* %s: most characters to print; -1 means no limit */
} Spec;

/* Print n characters of s inside the field. */
static void out_field(Out *out, const char *s, int n, Spec *spec)
{
    int pad = spec->width - n;
    if (!spec->left)
        out_repeat(out, ' ', pad);
    while (n > 0) {
        out_char(out, *s);
        s++;
        n--;
    }
    if (spec->left)
        out_repeat(out, ' ', pad);
}

/*
 * Print value in base 8, 10 or 16. sign is '-' for a negative number (value
 * is then its magnitude), prefix is "0x" for %p; both are 0 when unused.
 */
static void out_number(Out *out, unsigned int value, unsigned int base, int upper,
                       int sign, const char *prefix, Spec *spec)
{
    const char *digit_chars = upper ? "0123456789ABCDEF" : "0123456789abcdef";
    char digits[12]; /* 32 bits are at most 11 octal digits */
    int n = 0;
    int len;
    int pad;

    /* Digits come out lowest first, so digits[] is backwards. */
    do {
        digits[n] = digit_chars[value % base];
        n++;
        value = value / base;
    } while (value != 0);

    len = n;
    if (sign)
        len++;
    if (prefix)
        len = len + 2;
    pad = spec->width - len;

    if (!spec->left && !spec->zero)
        out_repeat(out, ' ', pad);
    if (sign)
        out_char(out, sign);
    if (prefix) {
        out_char(out, prefix[0]);
        out_char(out, prefix[1]);
    }
    if (!spec->left && spec->zero)
        out_repeat(out, '0', pad); /* zeros go after the sign: -0042 */
    while (n > 0) {
        n--;
        out_char(out, digits[n]);
    }
    if (spec->left)
        out_repeat(out, ' ', pad);
}

/* The formatter: walk fmt, copy plain characters, convert each %. */
static int format(Out *out, const char *fmt, va_list ap)
{
    while (*fmt != '\0') {
        Spec spec;
        int c;

        if (*fmt != '%') {
            out_char(out, *fmt);
            fmt++;
            continue;
        }
        fmt++; /* skip the % */

        /* Flags. */
        spec.left = 0;
        spec.zero = 0;
        while (*fmt == '-' || *fmt == '0') {
            if (*fmt == '-')
                spec.left = 1;
            else
                spec.zero = 1;
            fmt++;
        }

        /* Width: digits, or * to take it from the arguments. */
        spec.width = 0;
        if (*fmt == '*') {
            spec.width = va_arg(ap, int);
            if (spec.width < 0) {
                spec.left = 1;
                spec.width = -spec.width;
            }
            fmt++;
        }
        while (*fmt >= '0' && *fmt <= '9') {
            spec.width = spec.width * 10 + (*fmt - '0');
            fmt++;
        }

        /* Precision: .digits (used by %s). */
        spec.precision = -1;
        if (*fmt == '.') {
            fmt++;
            spec.precision = 0;
            while (*fmt >= '0' && *fmt <= '9') {
                spec.precision = spec.precision * 10 + (*fmt - '0');
                fmt++;
            }
        }

        /* Size letters: int, long and short all travel as 32-bit words here. */
        while (*fmt == 'l' || *fmt == 'h')
            fmt++;

        c = *fmt;
        if (c == '\0')
            break;
        fmt++;

        if (c == 'd' || c == 'i') {
            int v = va_arg(ap, int);
            if (v < 0)
                out_number(out, -(unsigned int)v, 10, 0, '-', NULL, &spec);
            else
                out_number(out, v, 10, 0, 0, NULL, &spec);
        } else if (c == 'u') {
            out_number(out, va_arg(ap, unsigned int), 10, 0, 0, NULL, &spec);
        } else if (c == 'x') {
            out_number(out, va_arg(ap, unsigned int), 16, 0, 0, NULL, &spec);
        } else if (c == 'X') {
            out_number(out, va_arg(ap, unsigned int), 16, 1, 0, NULL, &spec);
        } else if (c == 'o') {
            out_number(out, va_arg(ap, unsigned int), 8, 0, 0, NULL, &spec);
        } else if (c == 'p') {
            out_number(out, (unsigned int)va_arg(ap, void *), 16, 0, 0, "0x", &spec);
        } else if (c == 'c') {
            char ch = (char)va_arg(ap, int);
            out_field(out, &ch, 1, &spec);
        } else if (c == 's') {
            const char *s = va_arg(ap, const char *);
            int n = 0;
            if (s == NULL)
                s = "(null)";
            while (s[n] != '\0' && (spec.precision < 0 || n < spec.precision))
                n++;
            out_field(out, s, n, &spec);
        } else if (c == '%') {
            out_char(out, '%');
        } else {
            /* Unknown conversion: print it as written. */
            out_char(out, '%');
            out_char(out, c);
        }
    }
    return (int)out->len;
}

int vprintf(const char *fmt, va_list ap)
{
    Out out;
    out.buf = NULL;
    out.size = 0;
    out.len = 0;
    return format(&out, fmt, ap);
}

/* Writes at most size - 1 characters and a '\0'. Returns the full length it wanted. */
int vsnprintf(char *buf, size_t size, const char *fmt, va_list ap)
{
    Out out;
    int n;
    out.buf = buf;
    out.size = size;
    out.len = 0;
    n = format(&out, fmt, ap);
    if (size > 0) {
        if (out.len < size)
            buf[out.len] = '\0';
        else
            buf[size - 1] = '\0';
    }
    return n;
}

int printf(const char *fmt, ...)
{
    va_list ap;
    int n;
    va_start(ap, fmt);
    n = vprintf(fmt, ap);
    va_end(ap);
    return n;
}

int snprintf(char *buf, size_t size, const char *fmt, ...)
{
    va_list ap;
    int n;
    va_start(ap, fmt);
    n = vsnprintf(buf, size, fmt, ap);
    va_end(ap);
    return n;
}

/* No size given: assume the buffer is big enough (the caller must make sure). */
int sprintf(char *buf, const char *fmt, ...)
{
    va_list ap;
    int n;
    va_start(ap, fmt);
    n = vsnprintf(buf, 0x7fffffff, fmt, ap);
    va_end(ap);
    return n;
}
