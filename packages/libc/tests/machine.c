#include <stdio.h>
#include <machine.h>

int main(void)
{
    unsigned int v;
    csr_write(mscratch, 0x1234);
    v = csr_read(mscratch);
    printf("%x\n", v);
    csr_set(mscratch, 0xf0000);
    csr_clear(mscratch, 0x4);
    printf("%x %u\n", csr_read(mscratch), csr_read(mhartid));
    mmio_write8(UART_THR, '!');
    mmio_write8(UART_THR, '\n');
    printf("%d\n", (mmio_read8(UART_LSR) & UART_LSR_THR_EMPTY) != 0);
    return 0;
}
