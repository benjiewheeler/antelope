import BN from 'bn.js'

import {ABISerializableObject} from '../serializer/serializable'
import {Int64, UInt64} from './integer'
import {ABIEncoder} from '../serializer/encoder'
import {ABIDecoder} from '../serializer/decoder'
import {Name, NameType} from './name'

export type AssetType = Asset | string

export class Asset implements ABISerializableObject {
    static abiName = 'asset'

    units: Int64
    symbol: Asset.Symbol

    static from(value: AssetType) {
        if (value instanceof Asset) {
            return value
        }
        const parts = value.split(' ')
        if (parts.length !== 2) {
            throw new Error('Invalid asset string')
        }
        const amount = parts[0].replace('.', '')
        const precision = (parts[0].split('.')[1] || '').length
        const symbol = Asset.Symbol.fromParts(parts[1], precision)
        return new Asset(Int64.from(amount), symbol)
    }

    static fromABI(decoder: ABIDecoder): Asset {
        const units = Int64.fromABI(decoder)
        const symbol = Asset.Symbol.fromABI(decoder)
        return new Asset(units, symbol)
    }

    constructor(units: Int64, symbol: Asset.Symbol) {
        this.units = units
        this.symbol = symbol
    }

    equals(other: AssetType) {
        const {symbol, units} = Asset.from(other)
        return this.symbol.value.equals(symbol.value) && this.units.equals(units)
    }

    get value(): number {
        return this.symbol.convertUnits(this.units)
    }

    set value(newValue: number) {
        this.units = this.symbol.convertFloat(newValue)
    }

    toABI(encoder: ABIEncoder) {
        this.units.toABI(encoder)
        this.symbol.toABI(encoder)
    }

    toString() {
        const digits = this.units.toString().split('')
        let negative = false
        if (digits[0] === '-') {
            negative = true
            digits.shift()
        }
        const p = this.symbol.precision
        while (digits.length <= p) {
            digits.unshift('0')
        }
        if (p > 0) {
            digits.splice(digits.length - p, 0, '.')
        }
        let rv = digits.join('')
        if (negative) {
            rv = '-' + rv
        }
        return rv + ' ' + this.symbol.name
    }

    toJSON() {
        return this.toString()
    }
}

export namespace Asset {
    // eslint-disable-next-line @typescript-eslint/ban-types
    export type SymbolType = Symbol | UInt64 | string
    export class Symbol implements ABISerializableObject {
        static abiName = 'symbol'
        static symbolNamePattern = /^[A-Z]{1,7}$/
        static maxPrecision = 18

        static from(value: SymbolType) {
            if (value instanceof Symbol) {
                return value
            }
            if (value instanceof UInt64) {
                return new Symbol(value)
            }
            const parts = value.split(',')
            if (parts.length !== 2) {
                throw new Error('Invalid symbol string')
            }
            const precision = Number.parseInt(parts[0])
            return Symbol.fromParts(parts[1], precision)
        }

        static fromParts(name: string, precision: number) {
            return new Symbol(toRawSymbol(name, precision))
        }

        // eslint-disable-next-line @typescript-eslint/ban-types
        static fromABI(decoder: ABIDecoder): Symbol {
            return new Symbol(UInt64.fromABI(decoder))
        }

        value: UInt64

        constructor(value: UInt64) {
            if (toSymbolPrecision(value) > Symbol.maxPrecision) {
                throw new Error('Invalid asset symbol, precision too large')
            }
            if (!Symbol.symbolNamePattern.test(toSymbolName(value))) {
                throw new Error('Invalid asset symbol, name must be uppercase A-Z')
            }
            this.value = value
        }

        equals(other: SymbolType) {
            return this.value.equals(Symbol.from(other).value)
        }

        get name(): string {
            return toSymbolName(this.value)
        }

        get precision(): number {
            return toSymbolPrecision(this.value)
        }

        get code(): SymbolCode {
            return new SymbolCode(UInt64.from(this.value.value.clone().iushrn(8)))
        }

        toABI(encoder: ABIEncoder) {
            this.value.toABI(encoder)
        }

        /**
         * Convert units to floating point number according to symbol precision.
         * @throws If the given units can't be represented in 53 bits.
         **/
        convertUnits(units: Int64): number {
            return units.value.toNumber() / Math.pow(10, this.precision)
        }

        /**
         * Convert floating point to units according to symbol precision.
         * @throws If the resulting units can't be represented in 53 bits.
         **/
        convertFloat(float: number): Int64 {
            const rv = Math.pow(10, this.precision) * float
            if (rv >= 0x20000000000000) {
                throw new Error('Conversion looses precision')
            }
            return Int64.from(rv)
        }

        toString() {
            return `${this.precision},${this.name}`
        }

        toJSON() {
            return this.toString()
        }
    }

    export type SymbolCodeType = SymbolCode | UInt64 | string | number
    export class SymbolCode implements ABISerializableObject {
        static abiName = 'symbol_code'

        static from(value: SymbolCodeType) {
            if (value instanceof SymbolCode) {
                return value
            }
            if (typeof value === 'string') {
                value = UInt64.from(new BN(toRawSymbolCode(value), 'le'))
            }
            return new this(UInt64.from(value))
        }

        static fromABI(decoder: ABIDecoder) {
            return new SymbolCode(UInt64.fromABI(decoder))
        }

        value: UInt64

        constructor(value: UInt64) {
            this.value = value
        }

        equals(other: SymbolCodeType) {
            return this.value.equals(SymbolCode.from(other).value)
        }

        toABI(encoder: ABIEncoder) {
            this.value.toABI(encoder)
        }

        toString() {
            return charsToSymbolName(this.value.value.toArray('be'))
        }

        toJSON() {
            return this.toString()
        }
    }
}

export type ExtendedAssetType = ExtendedAsset | {quantity: AssetType; contract: NameType}
export class ExtendedAsset implements ABISerializableObject {
    static abiName = 'extended_asset'

    static from(value: ExtendedAssetType) {
        if (value instanceof ExtendedAsset) {
            return value
        }
        return new this(Asset.from(value.quantity), Name.from(value.contract))
    }

    static fromABI(decoder: ABIDecoder) {
        return new ExtendedAsset(Asset.fromABI(decoder), Name.fromABI(decoder))
    }

    quantity: Asset
    contract: Name

    constructor(quantity: Asset, contract: Name) {
        this.quantity = quantity
        this.contract = contract
    }

    equals(other: ExtendedAssetType) {
        return this.quantity.equals(other.quantity) && this.contract.equals(other.contract)
    }

    toABI(encoder: ABIEncoder) {
        this.quantity.toABI(encoder)
        this.contract.toABI(encoder)
    }

    toJSON() {
        return {
            quantity: this.quantity,
            contract: this.contract,
        }
    }
}

function toSymbolPrecision(rawSymbol: UInt64) {
    return rawSymbol.value.and(UInt64.from(0xff).value).toNumber()
}

function toSymbolName(rawSymbol: UInt64) {
    const chars = rawSymbol.value.toArray('be').slice(0, -1)
    return charsToSymbolName(chars)
}

function charsToSymbolName(chars: number[]) {
    return chars
        .map((char) => String.fromCharCode(char))
        .reverse()
        .join('')
}

function toRawSymbol(name: string, precision: number) {
    const array = toRawSymbolCode(name)
    array.unshift(precision)
    return UInt64.from(new BN(array, 'le'))
}

function toRawSymbolCode(name: string) {
    const array: number[] = []
    const length = Math.min(name.length, 7)
    for (let i = 0; i < length; i++) {
        array.push(name.charCodeAt(i))
    }
    return array
}
