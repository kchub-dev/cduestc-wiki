// DeepSeekHashV1 —— DeepSeek 网页版 PoW 的工作量证明哈希。
// 结构与 NIST FIPS 202 的 SHA3-256 相同（rate=136、0x06 域后缀、32 字节输出），
// 唯一区别是置换只执行 KECCAK-p[1600] 的后 23 轮（跳过第 1 个轮常数）。
// 求解规则：找到 nonce 使 hash(`${salt}_${expire_at}_${nonce}`) 与 64 位十六进制
// challenge 完全相等，nonce 搜索上限就是服务端下发的 difficulty。

const RATE_BYTES = 136
const OUTPUT_BYTES = 32
const FULL_ROUNDS = 24
const DEEPSEEK_ROUNDS = 23
const MAX_DIFFICULTY = 250_000
const HEX_CHARS = '0123456789abcdef'

// KECCAK 24 个轮常数（64 位，按低 / 高 32 位拆分）
const ROUND_CONSTANTS = [
    0x0000000000000001n,
    0x0000000000008082n,
    0x800000000000808An,
    0x8000000080008000n,
    0x000000000000808Bn,
    0x0000000080000001n,
    0x8000000080008081n,
    0x8000000000008009n,
    0x000000000000008An,
    0x0000000000000088n,
    0x0000000080008009n,
    0x000000008000000An,
    0x000000008000808Bn,
    0x800000000000008Bn,
    0x8000000000008089n,
    0x8000000000008003n,
    0x8000000000008002n,
    0x8000000000000080n,
    0x000000000000800An,
    0x800000008000000An,
    0x8000000080008081n,
    0x8000000000008080n,
    0x0000000080000001n,
    0x8000000080008008n,
]
const RC_LOW = Uint32Array.from(ROUND_CONSTANTS, value => Number(value & 0xFFFFFFFFn))
const RC_HIGH = Uint32Array.from(ROUND_CONSTANTS, value => Number(value >> 32n))

// ρ 循环移位量，按 lane = x + 5y 索引
const ROTATION_OFFSETS = [
    0,
    1,
    62,
    28,
    27,
    36,
    44,
    6,
    55,
    20,
    3,
    10,
    43,
    25,
    39,
    41,
    45,
    15,
    21,
    8,
    18,
    2,
    61,
    56,
    14,
]

// ρ+π 之后每个 lane 写入的目的 word 下标（2 * 目的 lane）
const RHO_PI_DEST = Uint8Array.from({ length: 25 }, (_, lane) => {
    const x = lane % 5
    const y = (lane - x) / 5
    return 2 * (y + 5 * ((2 * x + 3 * y) % 5))
})

// χ 步骤中 A[x,y] ^= ~B[x+1,y] & B[x+2,y] 用到的 word 下标
const CHI_NEXT = Uint8Array.from({ length: 25 }, (_, lane) => {
    const x = lane % 5
    const row = lane - x
    return 2 * (row + ((x + 1) % 5))
})
const CHI_NEXT_NEXT = Uint8Array.from({ length: 25 }, (_, lane) => {
    const x = lane % 5
    const row = lane - x
    return 2 * (row + ((x + 2) % 5))
})

// 64 位 lane 以相邻两个 uint32（低在前）存储；scratch/c/d 为调用方复用的缓冲。
function keccakF1600(state, scratch, columnParity, thetaMix, roundCount) {
    const firstRound = FULL_ROUNDS - roundCount

    for (let round = firstRound; round < FULL_ROUNDS; round++) {
        // θ
        for (let x = 0; x < 5; x++) {
            const word = 2 * x
            columnParity[word] = state[word] ^ state[word + 10] ^ state[word + 20] ^ state[word + 30] ^ state[word + 40]
            columnParity[word + 1] = state[word + 1] ^ state[word + 11] ^ state[word + 21] ^ state[word + 31] ^ state[word + 41]
        }
        for (let x = 0; x < 5; x++) {
            const previous = 2 * ((x + 4) % 5)
            const next = 2 * ((x + 1) % 5)
            const rotatedLow = (columnParity[next] << 1) | (columnParity[next + 1] >>> 31)
            const rotatedHigh = (columnParity[next + 1] << 1) | (columnParity[next] >>> 31)
            thetaMix[2 * x] = columnParity[previous] ^ rotatedLow
            thetaMix[2 * x + 1] = columnParity[previous + 1] ^ rotatedHigh
        }
        for (let x = 0; x < 5; x++) {
            const word = 2 * x
            const low = thetaMix[word]
            const high = thetaMix[word + 1]
            for (let y = 0; y < 5; y++) {
                const index = word + 10 * y
                state[index] ^= low
                state[index + 1] ^= high
            }
        }

        // ρ + π
        scratch[0] = state[0]
        scratch[1] = state[1]
        for (let lane = 1; lane < 25; lane++) {
            const source = 2 * lane
            const destination = RHO_PI_DEST[lane]
            const amount = ROTATION_OFFSETS[lane]
            const low = state[source]
            const high = state[source + 1]
            if (amount === 0) {
                scratch[destination] = low
                scratch[destination + 1] = high
            }
            else if (amount < 32) {
                scratch[destination] = (low << amount) | (high >>> (32 - amount))
                scratch[destination + 1] = (high << amount) | (low >>> (32 - amount))
            }
            else {
                const reduced = amount - 32
                scratch[destination] = (high << reduced) | (low >>> (32 - reduced))
                scratch[destination + 1] = (low << reduced) | (high >>> (32 - reduced))
            }
        }

        // χ
        for (let lane = 0; lane < 25; lane++) {
            const word = 2 * lane
            const next = CHI_NEXT[lane]
            const nextNext = CHI_NEXT_NEXT[lane]
            state[word] = scratch[word] ^ (~scratch[next] & scratch[nextNext])
            state[word + 1] = scratch[word + 1] ^ (~scratch[next + 1] & scratch[nextNext + 1])
        }

        // ι
        state[0] ^= RC_LOW[round]
        state[1] ^= RC_HIGH[round]
    }
}

function absorbBlock(state, bytes, offset) {
    for (let index = 0; index < RATE_BYTES; index++)
        state[index >>> 2] ^= bytes[offset + index] << ((index & 3) * 8)
}

function digestStateToHex(state) {
    let hex = ''
    for (let index = 0; index < OUTPUT_BYTES; index++) {
        const byte = (state[index >>> 2] >>> ((index & 3) * 8)) & 0xFF
        hex += HEX_CHARS[byte >>> 4] + HEX_CHARS[byte & 15]
    }
    return hex
}

/**
 * 通用海绵计算：输入为 UTF-8 字节，roundCount 取 24 即标准 SHA3-256，
 * 取 23 即 DeepSeekHashV1。
 */
function sponge(bytes, roundCount) {
    const state = new Uint32Array(50)
    const scratch = new Uint32Array(50)
    const columnParity = new Uint32Array(10)
    const thetaMix = new Uint32Array(10)
    let offset = 0

    while (offset + RATE_BYTES <= bytes.length) {
        absorbBlock(state, bytes, offset)
        keccakF1600(state, scratch, columnParity, thetaMix, roundCount)
        offset += RATE_BYTES
    }

    const finalBlock = new Uint8Array(RATE_BYTES)
    finalBlock.set(bytes.subarray(offset))
    finalBlock[bytes.length - offset] ^= 0x06
    finalBlock[RATE_BYTES - 1] ^= 0x80
    absorbBlock(state, finalBlock, 0)
    keccakF1600(state, scratch, columnParity, thetaMix, roundCount)

    return digestStateToHex(state)
}

function utf8Bytes(input) {
    return new TextEncoder().encode(input)
}

/** 标准 SHA3-256（用于自检：与 Node/OpenSSL 实现比对） */
export function sha3_256(input) {
    return sponge(utf8Bytes(input), FULL_ROUNDS)
}

/** DeepSeekHashV1 摘要（十六进制） */
export function deepSeekHashV1(input) {
    return sponge(utf8Bytes(input), DEEPSEEK_ROUNDS)
}

/**
 * 在 `prefix + nonce` 中搜索使 DeepSeekHashV1 摘要与 challenge 完全相等的
 * 最小 nonce。前缀的完整块只吸收一次，之后每个 nonce 仅复制基状态再做尾部
 * 异或，避免重复分配。未找到返回 -1。
 */
export function findDeepSeekPowNonce(prefix, challengeHex, difficulty) {
    if (typeof prefix !== 'string')
        throw new TypeError('DeepSeek PoW prefix 必须是字符串')
    if (!/^[a-f0-9]{64}$/i.test(challengeHex))
        throw new TypeError('DeepSeek PoW challenge 必须是 64 位十六进制摘要')
    if (!Number.isSafeInteger(difficulty) || difficulty < 1 || difficulty > MAX_DIFFICULTY)
        throw new RangeError(`DeepSeek PoW difficulty 必须在 1-${MAX_DIFFICULTY} 之间`)

    const prefixBytes = utf8Bytes(prefix)
    const target = challengeHex.toLowerCase()
    const targetWords = new Uint32Array(OUTPUT_BYTES / 4)
    for (let index = 0; index < OUTPUT_BYTES; index++)
        targetWords[index >>> 2] |= Number.parseInt(target.slice(index * 2, index * 2 + 2), 16) << ((index & 3) * 8)

    const scratch = new Uint32Array(50)
    const columnParity = new Uint32Array(10)
    const thetaMix = new Uint32Array(10)

    // 基状态：吸收前缀的完整块；剩余未满的字节作为尾部在循环内逐次异或。
    const baseState = new Uint32Array(50)
    let offset = 0
    while (offset + RATE_BYTES <= prefixBytes.length) {
        absorbBlock(baseState, prefixBytes, offset)
        keccakF1600(baseState, scratch, columnParity, thetaMix, DEEPSEEK_ROUNDS)
        offset += RATE_BYTES
    }
    const tail = prefixBytes.subarray(offset)
    const tailLength = tail.length

    const state = new Uint32Array(50)
    const permute = () => keccakF1600(state, scratch, columnParity, thetaMix, DEEPSEEK_ROUNDS)

    const digestMatches = () => {
        for (let word = 0; word < targetWords.length; word++) {
            if (state[word] !== targetWords[word])
                return false
        }
        return true
    }

    for (let nonce = 0; nonce < difficulty; nonce++) {
        state.set(baseState)
        for (let index = 0; index < tailLength; index++)
            state[index >>> 2] ^= tail[index] << ((index & 3) * 8)

        let position = tailLength
        const nonceText = String(nonce)
        for (let index = 0; index < nonceText.length; index++) {
            state[position >>> 2] ^= nonceText.charCodeAt(index) << ((position & 3) * 8)
            position++
            if (position === RATE_BYTES) {
                permute()
                position = 0
            }
        }

        state[position >>> 2] ^= 0x06 << ((position & 3) * 8)
        state[(RATE_BYTES - 1) >>> 2] ^= 0x80 << 24
        permute()

        if (digestMatches())
            return nonce
    }

    return -1
}

/**
 * 高层封装：给定服务端 challenge 对象（challenge/salt/expire_at/difficulty），
 * 返回答案 nonce。
 */
export function solveDeepSeekChallenge(challenge) {
    const challengeHex = challenge.challenge
    const salt = challenge.salt
    const expireAt = challenge.expire_at
    const difficulty = challenge.difficulty

    if (typeof salt !== 'string' || !salt.length)
        throw new Error('DeepSeek PoW challenge 缺少 salt')
    if (!Number.isSafeInteger(expireAt) || expireAt < 0)
        throw new Error('DeepSeek PoW challenge 缺少 expire_at')
    if (!Number.isSafeInteger(difficulty) || difficulty < 1)
        throw new Error('DeepSeek PoW challenge 缺少 difficulty')

    const prefix = `${salt}_${expireAt}_`
    const nonce = findDeepSeekPowNonce(prefix, challengeHex, difficulty)
    if (nonce < 0)
        throw new Error('DeepSeek PoW 求解失败：难度范围内未找到答案')
    return nonce
}
