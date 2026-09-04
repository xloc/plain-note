const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export const base58 = {
  encode(value: Uint8Array) {
    const digits = [0]
    for (const byte of value) {
      let carry = byte
      for (let index = 0; index < digits.length; index++) {
        carry += digits[index] * 256
        digits[index] = carry % 58
        carry = Math.floor(carry / 58)
      }
      while (carry) {
        digits.push(carry % 58)
        carry = Math.floor(carry / 58)
      }
    }

    let encoded = ''
    for (let index = 0; index < value.length - 1 && value[index] === 0; index++) encoded += BASE58[0]
    return (
      encoded +
      digits
        .reverse()
        .map((digit) => BASE58[digit])
        .join('')
    )
  },

  decode(value: string): Uint8Array<ArrayBuffer> {
    const bytes = [0]
    for (const character of value) {
      let carry = BASE58.indexOf(character)
      if (carry < 0) throw new Error('Encryption key is not valid')
      for (let index = 0; index < bytes.length; index++) {
        carry += bytes[index] * 58
        bytes[index] = carry & 0xff
        carry >>= 8
      }
      while (carry) {
        bytes.push(carry & 0xff)
        carry >>= 8
      }
    }

    for (let index = 0; index < value.length - 1 && value[index] === BASE58[0]; index++) bytes.push(0)
    return Uint8Array.from(bytes.reverse())
  },
}

export const base64 = {
  encode(value: ArrayBuffer | Uint8Array) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
    let binary = ''
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.slice(start, start + 0x8000))
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },

  decode(value: string): Uint8Array<ArrayBuffer> {
    try {
      const encoded = value.replace(/-/g, '+').replace(/_/g, '/')
      const binary = atob(encoded + '='.repeat((4 - (encoded.length % 4)) % 4))
      return Uint8Array.from(binary, (character) => character.charCodeAt(0))
    } catch {
      throw new Error('Encryption key is not valid')
    }
  },
}
