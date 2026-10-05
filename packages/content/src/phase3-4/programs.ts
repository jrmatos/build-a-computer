/**
 * Toy-8 programs used by the Phase 4 level tests and the CPU board tests.
 * Assembled with the Toy-8 assembler (docs/toy8.md).
 */

/** Multiply a × b by repeated addition; the product (mod 256) goes to OUT. */
export function multiplySource(a: number, b: number): string {
  return `; multiply ${a} x ${b} by repeated addition
        LDI R0, 0       ; product
        LDI R1, ${a}    ; a
        LDI R2, ${b}    ; b, counts down
        LDI R3, 1
        OR  R2, R2      ; Z = (b == 0)
        JZ  done
loop:   ADD R0, R1
        SUB R2, R3
        JNZ loop
done:   OUT R0
        HALT
`;
}

/** The first-program level's example: 6 × 7 = 42. */
export const MULTIPLY_SOURCE = multiplySource(6, 7);

/** Counts up forever with JMP, showing each value on OUT (no flags, no HALT). */
export const COUNT_UP_SOURCE = `
        LDI R0, 0
        LDI R1, 1
loop:   OUT R0
        ADD R0, R1
        JMP loop
`;

/** Fibonacci numbers on OUT forever, using MOV and JMP. */
export const FIBONACCI_LOOP_SOURCE = `
        LDI R0, 0
        LDI R1, 1
loop:   OUT R0
        MOV R2, R0
        ADD R2, R1
        MOV R0, R1
        MOV R1, R2
        JMP loop
`;

/** Counts 5 down to 0 with JNZ, then parks in a JMP-to-self loop (no HALT needed). */
export const COUNTDOWN_PARK_SOURCE = `
        LDI R0, 5
        LDI R1, 1
loop:   OUT R0
        SUB R0, R1
        JNZ loop
        OUT R0
park:   JMP park
`;

/** max(a, b) with JC (carry = no borrow), parked. */
export function maxParkSource(a: number, b: number): string {
  return `
        LDI R0, ${a}
        LDI R1, ${b}
        MOV R2, R0
        SUB R2, R1      ; C = (a >= b)
        JC  amax
        OUT R1
        JMP park
amax:   OUT R0
park:   JMP park
`;
}

/** JN: is a - b negative (as a signed byte)? OUT = 1 if so, else 2. Parked. */
export function signParkSource(a: number, b: number): string {
  return `
        LDI R0, ${a}
        LDI R1, ${b}
        SUB R0, R1
        JN  neg
        LDI R2, 2
        OUT R2
        JMP park
neg:    LDI R2, 1
        OUT R2
park:   JMP park
`;
}

/** Sum 1..n with a loop, ending in HALT. */
export function sumToSource(n: number): string {
  return `
        LDI R0, 0
        LDI R1, ${n}
        LDI R2, 1
        OR  R1, R1
        JZ  done
loop:   ADD R0, R1
        SUB R1, R2
        JNZ loop
done:   OUT R0
        HALT
`;
}

/** Store 1..4 in RAM at 0x40.., then sum it back with LD; OUT = 10. Exercises LD/ST/SHL/SHR/NOT/XOR/AND. */
export const MEMORY_SUM_SOURCE = `
        LDI R1, 0x40    ; pointer
        LDI R2, 1       ; value / step
        LDI R3, 4       ; count
fill:   ST  R2, [R1]
        LDI R0, 1
        ADD R1, R0
        ADD R2, R0
        SUB R3, R0
        JNZ fill
        LDI R1, 0x40
        LDI R2, 0       ; sum
        LDI R3, 4
sum:    LD  R0, [R1]
        ADD R2, R0
        LDI R0, 1
        ADD R1, R0
        SUB R3, R0
        JNZ sum
        LDI R0, 2
        SHL R2, R0      ; 40
        SHR R2, R0      ; 10
        NOT R2          ; 245
        NOT R2          ; 10
        LDI R0, 0xFF
        AND R2, R0
        XOR R0, R0
        OR  R2, R0
        OUT R2
        HALT
`;

/** Ends at once: HALT is byte 00. */
export const HALT_ONLY_SOURCE = 'HALT';

/** HALT must stop the machine: the second OUT never runs. */
export const HALT_STOPS_SOURCE = `
        LDI R0, 7
        OUT R0
        HALT
        LDI R0, 99
        OUT R0
        HALT
`;

/** JZ: OUT = 1 when x is 0, else 2. Parked. */
export function zeroParkSource(x: number): string {
  return `
        LDI R0, ${x}
        OR  R0, R0      ; Z = (x == 0)
        JZ  zero
        LDI R1, 2
        OUT R1
        JMP park
zero:   LDI R1, 1
        OUT R1
park:   JMP park
`;
}
