# usys.s: system call stubs. Each one puts its number in a7 and traps into
# the kernel with ecall; the arguments are already in a0-a2 and the result
# comes back in a0.

    .text
    .globl write
write:
    li   a7, 64
    ecall
    ret

    .globl read
read:
    li   a7, 63
    ecall
    ret

    .globl exit
exit:
    li   a7, 93
    ecall
    ret

    .globl getpid
getpid:
    li   a7, 172
    ecall
    ret

    .globl yield
yield:
    li   a7, 124
    ecall
    ret

    .globl sleep
sleep:
    li   a7, 101
    ecall
    ret

    .globl uptime
uptime:
    li   a7, 113
    ecall
    ret

    .globl spawn
spawn:
    li   a7, 220
    ecall
    ret

    .globl wait
wait:
    li   a7, 260
    ecall
    ret

    .globl sbrk
sbrk:
    li   a7, 214
    ecall
    ret

    .globl freemem
freemem:
    li   a7, 500
    ecall
    ret

    .globl open
open:
    li   a7, 56
    ecall
    ret

    .globl close
close:
    li   a7, 57
    ecall
    ret

    .globl readdir
readdir:
    li   a7, 61
    ecall
    ret

    .globl fbmap
fbmap:
    li   a7, 501
    ecall
    ret

    .globl getkey
getkey:
    li   a7, 502
    ecall
    ret

# raw_syscall(num, a, b, c): any system call by number.
    .globl raw_syscall
raw_syscall:
    mv   a7, a0
    mv   a0, a1
    mv   a1, a2
    mv   a2, a3
    ecall
    ret
