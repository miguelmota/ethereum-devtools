import React, {
  useMemo,
  useEffect,
  useState,
  SyntheticEvent,
  useCallback
} from 'react'
import {
  ethers,
  BigNumber,
  Contract,
  Wallet,
  Signer,
  providers,
  utils,
  ContractFactory
} from 'ethers'
import {
  ContractFactory as ZkSyncContractFactory,
  Web3Provider as ZkSyncWeb3Provider
} from 'zksync-ethers' // era
import InputDecoder from 'ethereum-input-data-decoder'
import nativeAbis from './abi'
import CustomERC20Artifact from './deploy/CustomERC20.json'
import ZkSyncCustomERC20Artifact from './deploy/ZkSyncCustomERC20.json'
import CID from 'cids'

import BlockDater from 'ethereum-block-by-date'
import { DateTime } from 'luxon'
import fourByte from '4byte'
import sigUtil from 'eth-sig-util'
import zksync from 'zksync' // v1
//import namehash from 'eth-ens-namehash' // namehash.hash(...)
import contentHash2 from '@ensdomains/content-hash'
import etherConverter from 'ether-converter'
import privateKeyToAddress from 'ethereum-private-key-to-address'
import privateKeyToPublicKey from 'ethereum-private-key-to-public-key'
import publicKeyToAddress from 'ethereum-public-key-to-address'
import base58 from 'bs58'
import contentHash from 'content-hash'
import { Buffer } from 'buffer'

// utils available as globals
;(window as any).BigNumber = BigNumber
;(window as any).ethers = ethers
;(window as any).utils = utils
;(window as any).CID = CID
;(window as any).contentHash = contentHash
;(window as any).base58 = base58
;(window as any).contentHash2 = contentHash2
;(window as any).DateTime = DateTime

const networkOptions = [
  'injected',
  'mainnet',
  'kovan',
  'goerli',
  'rinkeby',
  'ropsten',
  'polygon',
  'xdai',
  'arbitrum',
  'optimism'
]

const tokenDecimals: any = {
  ETH: 18,
  WETH: 18,
  wstEth: 18,
  stEth: 18,
  USDC: 6,
  DAI: 18
}

function intToHex (value: number) {
  try {
    return BigNumber.from((value || 0).toString()).toHexString()
  } catch (err) {
    return '0x'
  }
}

function getTxExplorerUrl (txHash: string, network: string) {
  let baseUrl = ''
  if (['mainnet', 'kovan', 'goerli', 'rinkeby', 'ropsten'].includes(network)) {
    const subdomain = network === 'mainnet' ? '' : `${network}.`
    baseUrl = `https://${subdomain}etherscan.io`
  } else if (network === 'optimism') {
    baseUrl = 'https://optimistic.etherscan.io'
  } else if (network === 'arbitrum') {
    baseUrl = 'https://arbiscan.io'
  } else if (network === 'polygon') {
    baseUrl = 'https://https://polygonscan.com'
  } else if (network === 'xdai') {
    baseUrl = 'https://blockscout.com/xdai/mainnet'
  } else if (network === 'avalance') {
    baseUrl = 'https://snowtrace.io'
  } else if (network === 'binance') {
    baseUrl = 'https://bscscan.com'
  }
  const path = `/tx/${txHash}`
  return `${baseUrl}${path}`
}

function Fieldset (props: any) {
  const { legend, children } = props
  return (
    <details open>
      <summary>
        <span className='open'>
          {legend} {'▾'}
        </span>
      </summary>
      <fieldset>
        <legend>
          {legend} <span className='close'>{'▴'}</span>
        </legend>
        {children}
      </fieldset>
    </details>
  )
}

function UnitConverter () {
  const [values, setValues] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem('converter') || '') || {}
    } catch (err) {
      return {}
    }
  })
  const units = [
    'wei',
    'kwei',
    'mwei',
    'gwei',
    'szabo',
    'finney',
    'ether',
    'kether',
    'mether',
    'gether',
    'tether'
  ]
  useEffect(() => {
    try {
      localStorage.setItem('converter', JSON.stringify(values))
    } catch (err) {
      console.error(err)
    }
  }, [values])

  return (
    <div>
      {units.map((unit, i) => {
        let val = values[unit] ?? ''
        let pow = -18 + i * 3
        let exp = pow ? (
          <>
            10<sup>{pow}</sup>
          </>
        ) : (
          1
        )
        return (
          <div key={unit}>
            <label>
              {unit} ({exp}) {unit === 'gwei' && <small>(gas)</small>}
            </label>
            <div style={{ display: 'flex' }}>
              <div style={{ width: '100%' }}>
                <input
                  type='text'
                  value={val}
                  onChange={(event: any) => {
                    try {
                      const value = event.target.value
                      const result = etherConverter(value, unit)
                      result[unit] = value
                      if (result['wei'] === 'NaN') {
                        setValues({})
                      } else {
                        setValues(result)
                      }
                    } catch (err) {
                      console.error(err)
                    }
                  }}
                />
              </div>
              <div style={{ width: '300px', marginLeft: '1rem' }}>
                {intToHex(val)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CustomTx (props: any = {}) {
  const { wallet } = props
  const cacheKey = 'customTxMethodType'
  const [methodType, setMethodType] = useState<string>(() => {
    return localStorage.getItem(cacheKey) || 'broadcast'
  })
  const [txhash, setTxhash] = useState<any>(null)
  const [result, setResult] = useState('')
  const [blockTag, setBlockTag] = useState<string>(() => {
    return localStorage.getItem('customTxBlockTag') || ''
  })
  const [tx, setTx] = useState<any>(() => {
    const defaultTx = JSON.stringify(
      {
        to: '',
        value: '',
        data: '',
        gasLimit: '',
        gasPrice: '',
        nonce: ''
      },
      null,
      2
    )
    try {
      return localStorage.getItem('customTx') || defaultTx
    } catch (err) {
      return defaultTx
    }
  })
  const handleChange = (event: any) => {
    const val = event.target.value
    setTx(val)
    localStorage.setItem('customTx', val)
  }
  const updateMethodType = (event: any) => {
    const { value } = event.target
    setMethodType(value)
    localStorage.setItem(cacheKey, value)
  }
  const send = async () => {
    try {
      setTxhash(null)
      setResult('')
      const txData = JSON.parse(tx)
      console.log(txData)
      let res: any
      if (methodType === 'static') {
        let _blockTag = undefined
        if (blockTag) {
          if (!Number.isNaN(Number(blockTag))) {
            _blockTag = Number(blockTag)
          } else {
            _blockTag = blockTag
          }
        }

        res = await wallet.provider.call(txData, _blockTag)
      } else if (methodType === 'populate') {
        res = await wallet.populateTransaction(txData)
      } else if (methodType === 'estimate') {
        res = await wallet.provider.estimateGas(txData)
      } else if (methodType === 'sign') {
        res = await wallet.signTransaction(txData)
      } else {
        res = await wallet.sendTransaction(txData)
      }
      setTxhash(res?.hash)
      setResult(JSON.stringify(res, null, 2))
    } catch (err) {
      alert(err.message)
    }
  }

  const updateBlockTag = (val: string) => {
    setBlockTag(val)
    localStorage.setItem('customTxBlockTag', val)
  }

  const txLink = txhash ? getTxExplorerUrl(txhash, props.network) : null

  return (
    <div>
      <div>
        <small>Use hex values</small>
      </div>
      <textarea value={tx} onChange={handleChange} />
      <label>block tag (for static calls)</label>
      <TextInput
        value={blockTag}
        placeholder={'latest'}
        onChange={updateBlockTag}
      />
      <div>
        <section>
          <label>
            <input
              type='radio'
              value='broadcast'
              checked={methodType === 'broadcast'}
              onChange={updateMethodType}
            />
            sign & broadcast
          </label>

          <label>
            <input
              type='radio'
              value='static'
              checked={methodType === 'static'}
              onChange={updateMethodType}
            />
            call static
          </label>

          <label>
            <input
              type='radio'
              value='populate'
              checked={methodType === 'populate'}
              onChange={updateMethodType}
            />
            populate call
          </label>

          <label>
            <input
              type='radio'
              value='sign'
              checked={methodType === 'sign'}
              onChange={updateMethodType}
            />
            sign tx
          </label>

          <label>
            <input
              type='radio'
              value='estimate'
              checked={methodType === 'estimate'}
              onChange={updateMethodType}
            />
            estimate gas
          </label>
        </section>
      </div>
      <div>
        <button onClick={send}>submit</button>
      </div>
      <pre>{result}</pre>
      {txLink && (
        <a href={txLink} target='_blank' rel='noopener noreferrer'>
          {txLink}
        </a>
      )}
    </div>
  )
}

function SendRawTx (props: any) {
  const { provider } = props
  const [value, setValue] = useState(
    localStorage.getItem('sendRawTxValue') || ''
  )
  const [result, setResult] = useState<any>(null)
  useEffect(() => {
    localStorage.setItem('sendRawTxValue', value || '')
  }, [value])
  const handleValueChange = (value: string) => {
    setValue(value)
  }
  const sendTx = async () => {
    try {
      setResult(null)
      if (!value) {
        throw new Error('data is required')
      }
      const _tx = await provider.sendTransaction(value)
      setResult(_tx)
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    sendTx()
  }
  const output = JSON.stringify(result, null, 2)
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Signed raw transaction (hex)</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='0x...'
          variant='textarea'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>send</button>
        </div>
      </form>
      <div>
        <pre>{output}</pre>
      </div>
    </div>
  )
}

function Select (props: any = {}) {
  const handleChange = (event: any) => {
    const value = event.target.value
    if (props.onChange) {
      props.onChange(value)
    }
  }
  return (
    <select value={props.selected} onChange={handleChange}>
      {props.options.map((option: any, i: number) => {
        let label = option
        let value = option
        if (typeof option === 'object') {
          label = option.label
          value = option.value
        }
        return (
          <option key={i} value={value}>
            {label}
          </option>
        )
      })}
    </select>
  )
}

function TextInput (props: any = {}) {
  const [value, setValue] = useState('')
  const handleChange = (event: any) => {
    const val = event.target.value
    setValue(val)
    if (props.onChange) {
      props.onChange(val)
    }
  }
  useEffect(() => {
    setValue(props.value)
  }, [props.value])
  let el: any
  if (props.variant === 'textarea') {
    el = (
      <textarea
        readOnly={props.readOnly}
        disabled={props.disabled}
        placeholder={props.placeholder}
        value={value || ''}
        onChange={handleChange}
      />
    )
  } else {
    el = (
      <input
        readOnly={props.readOnly}
        disabled={props.disabled}
        placeholder={props.placeholder}
        type='text'
        value={value || ''}
        onChange={handleChange}
      />
    )
  }
  return el
}

type AbiMethodFormProps = {
  abi: any
  contractAddress: string
  wallet: Wallet
  network: string
}

function AbiMethodForm (props: AbiMethodFormProps) {
  const { abi: abiObj, contractAddress, wallet, network } = props
  const cacheKey = JSON.stringify(abiObj)
  const [args, setArgs] = useState<any>(() => {
    const defaultArgs: any = {}
    try {
      return JSON.parse(localStorage.getItem(cacheKey) as any) || defaultArgs
    } catch (err) {
      return defaultArgs
    }
  })
  const [gasLimit, setGasLimit] = useState<string>(() => {
    return localStorage.getItem('gasLimit') || ''
  })
  const [gasPrice, setGasPrice] = useState<string>(() => {
    return localStorage.getItem('gasPrice') || ''
  })
  const [value, setValue] = useState<string>(() => {
    return localStorage.getItem('value') || ''
  })
  const [fromAddress, setFromAddress] = useState<string>('')
  const [nonce, setNonce] = useState<string>(() => {
    return localStorage.getItem('nonce') || ''
  })
  const [blockTag, setBlockTag] = useState<string>(() => {
    return localStorage.getItem('blockTag') || ''
  })
  const [methodSig, setMethodSig] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [result, setResult] = useState('')
  const [callStatic, setCallStatic] = useState<boolean>(() => {
    try {
      return localStorage.getItem('callStatic') === 'true'
    } catch (err) {}
    return false
  })
  const [txhash, setTxhash] = useState<any>(null)
  const [tx, setTx] = useState<any>(null)
  const windowWeb3 = (window as any).ethereum
  const provider = useMemo(() => {
    if (windowWeb3) {
      return new providers.Web3Provider(windowWeb3, 'any')
    }
  }, [windowWeb3])
  useEffect(() => {
    const update = async () => {
      try {
        const address = await provider?.getSigner()?.getAddress()
        setFromAddress(address || '')
      } catch (err) {
        console.error(err)
      }
    }
    update()
  }, [provider, fromAddress, setFromAddress])

  useEffect(() => {
    let tx: any = {
      from: fromAddress ? fromAddress : undefined,
      to: contractAddress ? contractAddress : undefined,
      value: value ? value : undefined,
      gasPrice: gasPrice
        ? utils.parseUnits(gasPrice, 'gwei').toString()
        : undefined,
      gasLimit: gasLimit ? gasLimit : undefined,
      nonce: nonce ? nonce : undefined
    }

    try {
      setError('')
      if (abiObj) {
        const iface = new utils.Interface([abiObj])

        const parsed = args
        for (const key in parsed) {
          const value = parsed[key]
          try {
            const p = JSON.parse(value)
            if (Array.isArray(p)) {
              parsed[key] = p
            }
          } catch (err) {}
        }

        const data = iface.encodeFunctionData(
          abiObj.name,
          Object.values(parsed).slice(0, abiObj?.inputs?.length ?? 0)
        )
        tx.data = data
      }
    } catch (err) {
      setError(err.message)
    }

    setTx(tx)
  }, [
    abiObj,
    contractAddress,
    gasPrice,
    gasLimit,
    value,
    fromAddress,
    nonce,
    args
  ])

  useEffect(() => {
    try {
      setMethodSig('')
      if (abiObj.signature) {
        setMethodSig(abiObj.signature)
      } else {
        const iface = new utils.Interface([abiObj])
        const keys = Object.keys(iface.functions)
        if (keys.length) {
          const _methodSig = `0x${(window as any)
            .keccak256(keys[0])
            .toString('hex')
            .slice(0, 8)}`
          setMethodSig(_methodSig)
        }
      }
    } catch (err) {
      console.error(err)
    }
  }, [abiObj])

  if (abiObj.type !== 'function') {
    return null
  }

  const handleSubmit = async (event: any) => {
    event.preventDefault()
    try {
      if (error) {
        throw new Error(error)
      }
      if (!contractAddress) {
        throw new Error('contract address is required')
      }
      setTxhash(null)
      setResult('')
      const contract = new Contract(contractAddress, [abiObj], wallet)

      const txOpts: any = {
        gasPrice: tx.gasPrice,
        gasLimit: tx.gasLimit,
        value: tx.value
      }

      if (callStatic && blockTag) {
        if (!Number.isNaN(Number(blockTag))) {
          txOpts.blockTag = Number(blockTag)
        } else {
          txOpts.blockTag = blockTag
        }
      }

      const contractArgs = Object.values(args).reduce(
        (acc: any[], val: any, i: number) => {
          if (abiObj.inputs[i].type?.endsWith('[]') && typeof val == 'string') {
            val = val.split(',').map((x: string) => x.trim())
          }
          acc.push(val)
          return acc
        },
        []
      )

      const constructGsafeTx = false
      if (constructGsafeTx) {
        const { chainId } = await wallet.provider.getNetwork()
        const gsafeOutput: any = {
          version: '1.0',
          chainId: chainId.toString(),
          createdAt: Date.now(),
          meta: {
            name: '',
            description: '',
            txBuilderVersion: '',
            createdFromSafeAddress: '',
            createdFromOwnerAddress: '',
            checksum: ''
          },
          transactions: []
        }
        gsafeOutput.transactions.push({
          to: contractAddress,
          data: null,
          value: tx.value || '0',
          contractMethod: abiObj,
          contractInputsValues: contractArgs.reduce(
            (acc: any, value: any, i: number) => {
              acc[abiObj.inputs[i].name] = value
              return acc
            },
            {}
          )
        })
        console.log('gsafe tx:', JSON.stringify(gsafeOutput, null, 2))
      }

      console.log('contract args:', contractArgs)
      const res = await contract[callStatic ? 'callStatic' : 'functions'][
        abiObj.name
      ](...contractArgs, txOpts)
      console.log('result:', result)
      setTxhash(res?.hash)
      setResult(JSON.stringify(res, null, 2))
    } catch (err) {
      console.error(err)
      alert(err.message)
    }
  }
  const updateGasLimit = (val: string) => {
    setGasLimit(val)
    localStorage.setItem('gasLimit', val)
  }
  const updateGasPrice = (val: string) => {
    setGasPrice(val)
    localStorage.setItem('gasPrice', val)
  }
  const updateValue = (val: string) => {
    setValue(val)
    localStorage.setItem('value', val)
  }
  const updateNonce = (val: string) => {
    setNonce(val)
    localStorage.setItem('nonce', val)
  }
  const updateBlockTag = (val: string) => {
    setBlockTag(val)
    localStorage.setItem('blockTag', val)
  }
  const updateCallStatic = (event: any) => {
    const { checked } = event.target
    setCallStatic(checked)
    localStorage.setItem('callStatic', checked)
  }

  const txLink = txhash ? getTxExplorerUrl(txhash, network) : null
  const stateMutability = abiObj?.stateMutability
  const methodType = abiObj?.type
  const isWritable =
    ['nonpayable', 'payable'].includes(stateMutability) &&
    methodType === 'function'

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label style={{ marginBottom: '0.5rem' }}>
          <strong>{abiObj.name}</strong>{' '}
          {stateMutability ? `(${stateMutability})` : null} (
          {isWritable ? 'writable' : 'read-only'})
        </label>
        {!!methodSig && (
          <div style={{ margin: '0.5rem 0' }}>
            method signature: <code>{methodSig}</code>
          </div>
        )}
        {abiObj?.inputs?.map((input: any, i: number) => {
          const convertTextToHex = (event: SyntheticEvent) => {
            event.preventDefault()
            try {
              const newArgs = Object.assign({}, args)
              if (!utils.isHexString(args[i])) {
                newArgs[i] = utils.hexlify(Buffer.from(args[i]))
                localStorage.setItem(cacheKey, JSON.stringify(newArgs))
                setArgs(newArgs)
              }
            } catch (err) {
              alert(err)
            }
          }
          let inputValue = args[i]
          if (Array.isArray(inputValue)) {
            try {
              inputValue = JSON.stringify(inputValue)
            } catch (err) {}
          }
          return (
            <div key={i}>
              <label>
                {input.name} ({input.type}) *{' '}
                {input.type === 'address' && windowWeb3 ? (
                  <button
                    onClick={async (event: SyntheticEvent) => {
                      event.preventDefault()
                      const provider = new providers.Web3Provider(
                        windowWeb3,
                        'any'
                      )
                      const newArgs = Object.assign({}, args)
                      newArgs[i] = await provider?.getSigner()?.getAddress()
                      localStorage.setItem(cacheKey, JSON.stringify(newArgs))
                      setArgs(newArgs)
                    }}
                  >
                    from web3
                  </button>
                ) : null}
                {input.type?.startsWith('bytes') ? (
                  <>
                    <span>
                      (
                      {input.type?.includes('[]')
                        ? 'must be array of hex'
                        : 'must be hex'}
                      )
                    </span>
                    &nbsp;
                    <button onClick={convertTextToHex}>hexlify</button>
                  </>
                ) : null}
              </label>
              <TextInput
                value={inputValue}
                placeholder={input.type}
                onChange={(val: string) => {
                  val = val.trim()
                  const newArgs = Object.assign({}, args)
                  if (input.type === 'address') {
                    if (val) {
                      try {
                        val = utils.getAddress(val)
                      } catch (err) {
                        // noop
                      }
                    }
                  }
                  newArgs[i] = val
                  localStorage.setItem(cacheKey, JSON.stringify(newArgs))
                  setArgs(newArgs)
                }}
              />
            </div>
          )
        })}
        {abiObj?.inputs.length ? <small>* = Required</small> : null}
        <div style={{ padding: '1rem' }}>
          <label style={{ marginBottom: '0.5rem' }}>
            Transaction options (optional)
          </label>
          <label>gas limit</label>
          <TextInput
            value={gasLimit}
            placeholder={'gas limit'}
            onChange={updateGasLimit}
          />
          <label>gas price (gwei)</label>
          <TextInput
            value={gasPrice}
            placeholder={'gas price'}
            onChange={updateGasPrice}
          />
          <label>value (wei)</label>
          <TextInput
            value={value}
            placeholder={'value'}
            onChange={updateValue}
          />
          <label>nonce</label>
          <TextInput
            value={nonce}
            placeholder={'nonce'}
            onChange={updateNonce}
          />
          <label>block tag (for static calls)</label>
          <TextInput
            value={blockTag}
            placeholder={'latest'}
            onChange={updateBlockTag}
          />
        </div>
        {abiObj?.outputs.length ? (
          <div>
            <label style={{ marginBottom: '0.5rem' }}>Return values</label>
            <ol>
              {abiObj?.outputs?.map((obj: any) => {
                return (
                  <li key={obj.name}>
                    {obj.name} ({obj.type})
                  </li>
                )
              })}
            </ol>
          </div>
        ) : null}
        {tx && (
          <div>
            <label style={{ marginBottom: '0.5rem' }}>Transaction object</label>
            <pre>{JSON.stringify(tx, null, 2)}</pre>
          </div>
        )}
        <div>
          <input
            type='checkbox'
            checked={callStatic}
            onChange={updateCallStatic}
          />
          call static
        </div>
        <div>
          <button type='submit'>Submit</button>
        </div>
      </form>
      <pre>{result}</pre>
      {txLink && (
        <a href={txLink} target='_blank' rel='noopener noreferrer'>
          {txLink}
        </a>
      )}
    </div>
  )
}

function AbiEventForm (props: any = {}) {
  const { contractAddress, provider, abi: abiObj } = props
  const inputs = abiObj?.inputs || []
  const [eventSignature, setEventSignature] = useState<string>('')
  const [startBlock, setStartBlock] = useState<string>(() => {
    return localStorage.getItem('abiEventStartBlock') || ''
  })
  const [endBlock, setEndBlock] = useState<string>(() => {
    return localStorage.getItem('abiEventEndBlock') || ''
  })
  const [filterArgs, setFilterArgs] = useState<string>(() => {
    return localStorage.getItem('abiEventFilterArgs') || ''
  })
  const [loading, setLoading] = useState<boolean>(false)
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    try {
      localStorage.setItem('abiEventStartBlock', startBlock)
    } catch (err) {
      console.error(err)
    }
  }, [startBlock])

  useEffect(() => {
    try {
      localStorage.setItem('abiEventEndBlock', endBlock)
    } catch (err) {
      console.error(err)
    }
  }, [endBlock])

  useEffect(() => {
    try {
      localStorage.setItem('abiEventFilterArgs', filterArgs)
    } catch (err) {
      console.error(err)
    }
  }, [filterArgs])

  useEffect(() => {
    try {
      setEventSignature('')
      if (abiObj.signature) {
        setEventSignature(abiObj.signature)
      } else {
        const iface = new utils.Interface([abiObj])
        const keys = Object.keys(iface.events)
        if (keys.length) {
          const _methodSig = `0x${(window as any)
            .keccak256(keys[0])
            .toString('hex')}`
          setEventSignature(_methodSig)
        }
      }
    } catch (err) {}
  }, [abiObj])

  const fetchEvents = async () => {
    const contract = new Contract(contractAddress, [abiObj], provider)
    const startBlockNumber = Number(startBlock)
    const endBlockNumber = Number(endBlock)
    let args = []
    try {
      if (filterArgs) {
        args = JSON.parse(filterArgs)
      }
    } catch (err) {
      console.error(err)
    }
    const filter = contract.filters[abiObj.name](...args)
    const logs = contract.queryFilter(filter, startBlockNumber, endBlockNumber)
    return logs
  }

  const handleSubmit = async (event: any) => {
    event.preventDefault()
    try {
      setLoading(true)
      setResult(null)
      const result = await fetchEvents()
      setResult(result)
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }

  const handleStartBlock = (value: string) => {
    setStartBlock(value)
  }

  const handleEndBlock = (value: string) => {
    setEndBlock(value)
  }

  const handleFilterArgs = (value: string) => {
    setFilterArgs(value)
  }

  return (
    <div>
      <div style={{ marginBottom: '0.5rem' }}>Event</div>
      <div>
        <label>
          <strong>{abiObj.name}</strong>
        </label>
      </div>
      <ol>
        {inputs.map((input: any, i: number) => {
          return (
            <li key={i}>
              <strong>{input.name}</strong> ({input.type}){' '}
              {input.indexed ? `(indexed)` : null}
            </li>
          )
        })}
      </ol>
      <div>
        <label>Signature</label>
        {eventSignature}
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ marginTop: '0.5rem' }}>
          <label>
            Start block{' '}
            <button
              onClick={async (event: SyntheticEvent) => {
                event.preventDefault()
                try {
                  const { number } = await provider.getBlock()
                  setStartBlock(number.toString())
                } catch (err) {
                  alert(err.message)
                }
              }}
            >
              latest
            </button>
          </label>
          <TextInput
            value={startBlock}
            onChange={handleStartBlock}
            placeholder='0'
          />
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <label>
            End block{' '}
            <button
              onClick={async (event: SyntheticEvent) => {
                event.preventDefault()
                try {
                  const { number } = await provider.getBlock()
                  setEndBlock(number.toString())
                } catch (err) {
                  alert(err.message)
                }
              }}
            >
              latest
            </button>
          </label>
          <TextInput
            value={endBlock}
            onChange={handleEndBlock}
            placeholder='0'
          />
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <label>
            Arguments (optional){' '}
            <small>
              <a
                href='https://docs.ethers.io/v5/concepts/events/'
                target='_blank'
                rel='noopener noreferrer'
              >
                examples
              </a>
            </small>
          </label>
          <TextInput
            value={filterArgs}
            onChange={handleFilterArgs}
            placeholder={`pass event args as array
e.g. for erc20 transfer events:
     [fromAddress, toAddress] // filter by from/to address
     [null, [toMyAddress, orToOtherAddress]] // filter by to address
`.trim()}
            variant='textarea'
          />
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get events</button>
        </div>
      </form>
      <div>
        {loading && 'loading...'}
        <div>{!!result && `events: ${result.length}`}</div>
        <pre>{!!result && JSON.stringify(result, null, 2)}</pre>
      </div>
    </div>
  )
}

function DataDecoder (props: any) {
  const { abi, abiName } = props
  const [inputData, setInputData] = useState(
    localStorage.getItem('decodeInputData') || ''
  )
  const [result, setResult] = useState<any>(null)
  useEffect(() => {
    localStorage.setItem('decodeInputData', inputData || '')
  }, [inputData])
  const decode = () => {
    if (!(abi && abi.length)) {
      throw new Error('abi required')
    }
    const decoder = new InputDecoder(abi)
    const decoded = decoder.decodeData(inputData)
    setResult(decoded)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    try {
      decode()
    } catch (err) {
      alert(err.message)
    }
  }
  const handleInputDataChange = (value: string) => {
    setInputData(value)
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div>
          <label>
            Decode transaction calldata using <strong>{abiName}</strong> ABI
          </label>
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <label>Input data (hex)</label>
          <TextInput
            value={inputData}
            onChange={handleInputDataChange}
            placeholder='0x'
            variant='textarea'
          />
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>decode</button>
        </div>
      </form>
      <div>
        <pre>{result ? JSON.stringify(result, null, 2) : ''}</pre>
      </div>
    </div>
  )
}

function SendEth (props: any) {
  const { wallet } = props
  const [address, setAddress] = useState<string>('')
  const [balance, setBalance] = useState<string>('')
  const [amount, setAmount] = useState(localStorage.getItem('sendEthAmount'))
  const [recipient, setRecipient] = useState(
    localStorage.getItem('sendEthRecipient')
  )
  const [result, setResult] = useState<any>(null)
  useEffect(() => {
    const update = async () => {
      setAddress('')
      setBalance('')
      if (!wallet) {
        return
      }
      let signer: Signer
      if (wallet._isSigner) {
        signer = wallet
      } else if (wallet.getSigner) {
        signer = await wallet.getSigner()
      } else {
        return
      }
      try {
        const _address = await signer.getAddress()
        setAddress(_address)
        const _balance = await signer.getBalance()
        setBalance(utils.formatUnits(_balance.toString(), 18))
      } catch (err) {
        console.error(err)
      }
    }
    update()
  }, [wallet])
  useEffect(() => {
    localStorage.setItem('sendEthAmount', amount || '')
  }, [amount])
  useEffect(() => {
    localStorage.setItem('sendEthRecipient', recipient || '')
  }, [recipient])
  const handleAmountChange = (value: string) => {
    setAmount(value)
  }
  const handleRecipientChange = (value: string) => {
    setRecipient(value)
  }
  const send = async () => {
    setResult(null)
    if (!amount) {
      throw new Error('amount is required')
    }
    if (!recipient) {
      throw new Error('recipient is required')
    }
    const tx = await wallet.sendTransaction({
      to: recipient,
      value: BigNumber.from(amount)
    })
    setResult(tx)
    tx.wait((receipt: any) => {
      setResult(receipt)
    })
  }
  const handleSubmit = async (event: any) => {
    event.preventDefault()
    try {
      await send()
    } catch (err) {
      alert(err.message)
    }
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Address</label>
          <div>{address}</div>
        </div>
        <div>
          <label>Balance</label>
          <div>{balance} ETH</div>
        </div>
        <div>
          <label>Amount (uint256) *</label>
          <TextInput
            value={amount}
            onChange={handleAmountChange}
            placeholder='uint256'
          />
        </div>
        <div>
          <label>Recipient (address) *</label>
          <TextInput
            value={recipient}
            onChange={handleRecipientChange}
            placeholder='address'
          />
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>send</button>
        </div>
      </form>
      <div>
        <pre>{result ? JSON.stringify(result, null, 2) : ''}</pre>
      </div>
    </div>
  )
}

function GetTx (props: any) {
  const { provider } = props
  const [txHash, setTxHash] = useState(localStorage.getItem('getTxHash'))
  const [result, setResult] = useState(null)
  useEffect(() => {
    localStorage.setItem('getTxHash', txHash || '')
  }, [txHash])
  const handleTxHashChange = (value: string) => {
    setTxHash(value)
  }
  const getTx = async () => {
    try {
      setResult(null)
      const _tx = await provider.getTransaction(txHash)
      setResult(_tx)
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    getTx()
  }
  const _result = JSON.stringify(result, null, 2)
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Transaction hash</label>
        <TextInput
          value={txHash}
          onChange={handleTxHashChange}
          placeholder='hash'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get transaction</button>
        </div>
      </form>
      <div>
        <pre>{_result}</pre>
      </div>
    </div>
  )
}

function TxReceipt (props: any) {
  const { provider } = props
  const [txHash, setTxHash] = useState(localStorage.getItem('txReceiptHash'))
  const [receipt, setReceipt] = useState(null)
  useEffect(() => {
    localStorage.setItem('txReceiptHash', txHash || '')
  }, [txHash])
  const handleTxHashChange = (value: string) => {
    setTxHash(value)
  }
  const getReceipt = async () => {
    try {
      setReceipt(null)
      const _receipt = await provider.getTransactionReceipt(txHash)
      setReceipt(_receipt)
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    getReceipt()
  }
  const result = JSON.stringify(receipt, null, 2)
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Transaction hash</label>
        <TextInput
          value={txHash}
          onChange={handleTxHashChange}
          placeholder='hash'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get receipt</button>
        </div>
      </form>
      <div>
        <pre>{result}</pre>
      </div>
    </div>
  )
}

function GetBlock (props: any) {
  const { provider } = props
  const [blockNumber, setBlockNumber] = useState(
    localStorage.getItem('blockNumber')
  )
  const [block, setBlock] = useState(null)
  useEffect(() => {
    localStorage.setItem('blockNumber', blockNumber || '')
  }, [blockNumber])
  const handleBlockNumberChange = (value: string) => {
    setBlockNumber(value)
  }
  const getBlock = async () => {
    try {
      setBlock(null)
      const _block = await provider.getBlock(
        blockNumber ? Number(blockNumber) : undefined
      )
      setBlock(_block)
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    getBlock()
  }
  const result = JSON.stringify(block, null, 2)
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>
          Block number <small>(optional)</small>
        </label>
        <TextInput
          value={blockNumber}
          onChange={handleBlockNumberChange}
          placeholder='number'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get block</button>
        </div>
      </form>
      <div>
        <pre>{result}</pre>
      </div>
    </div>
  )
}

function GetCode (props: any) {
  const { provider } = props
  const [address, setAddress] = useState(localStorage.getItem('getCodeAddress'))
  const [code, setCode] = useState(null)
  useEffect(() => {
    localStorage.setItem('getCodeAddress', address || '')
  }, [address])
  const handleAddressChange = (value: string) => {
    setAddress(value)
  }
  const getCode = async () => {
    setCode(null)
    const _code = await provider.getCode(address)
    setCode(_code)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    getCode()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Address</label>
        <TextInput
          value={address}
          onChange={handleAddressChange}
          placeholder='0x'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get code</button>
        </div>
      </form>
      <div>
        <pre>{code}</pre>
      </div>
    </div>
  )
}

function GetGasPrice (props: any) {
  const { provider } = props
  const [gasPrice, setGasPrice] = useState<any>(null)
  const getGasPrice = async () => {
    setGasPrice(null)
    const _gasPrice = await provider.getGasPrice()
    setGasPrice(_gasPrice?.toString())
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    getGasPrice()
  }

  const gasPriceGwei = gasPrice ? utils.formatUnits(gasPrice, 9) : ''

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get gas price</button>
        </div>
      </form>
      <div>
        <div>
          {!!gasPrice && (
            <>
              <code>{gasPrice}</code> wei
            </>
          )}
        </div>
        <div>
          {!!gasPriceGwei && (
            <>
              <code>{gasPriceGwei}</code> gwei
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function GetFeeData (props: any) {
  const { provider } = props
  const [feeData, setFeeData] = useState<any>(null)
  const getFeeData = async () => {
    setFeeData(null)
    const _feeData = await provider.getFeeData()
    setFeeData(_feeData)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    getFeeData()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get gas fee data</button>
        </div>
      </form>
      <div>{!!feeData && <pre>{JSON.stringify(feeData, null, 2)}</pre>}</div>
    </div>
  )
}

function GetNonce (props: any) {
  const { provider } = props
  const [address, setAddress] = useState(
    localStorage.getItem('getNonceAddress')
  )
  const [nonce, setNonce] = useState<number | null>(null)
  useEffect(() => {
    localStorage.setItem('getNonceAddress', address || '')
  }, [address])
  const [pending, setPending] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem('getTransactionCountPending') ?? true)
    } catch (err) {}
    return true
  })
  const [blockTag, setBlockTag] = useState<string>(() => {
    try {
      return localStorage.getItem('getTransactionCountBlockTag') || ''
    } catch (err) {}
    return ''
  })
  useEffect(() => {
    localStorage.setItem('getTransactionCountBlockTag', blockTag || '')
  }, [blockTag])
  useEffect(() => {
    localStorage.setItem('getTransactionCountPending', `${pending}`)
  }, [pending])
  const handleAddressChange = (value: string) => {
    setAddress(value)
  }
  const getNonce = async () => {
    try {
      setNonce(null)
      let _blockTag: any = blockTag
      if (blockTag) {
        if (!Number.isNaN(Number(blockTag))) {
          _blockTag = Number(blockTag)
        } else {
          _blockTag = blockTag
        }
      }
      if (pending) {
        _blockTag = 'pending'
      }
      if (!_blockTag) {
        _blockTag = 'latest'
      }

      const _nonce = await provider.getTransactionCount(address, _blockTag)
      setNonce(Number(_nonce.toString()))
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    getNonce()
  }
  const updateBlockTagCheck = (event: any) => {
    const { checked } = event.target
    setPending(checked)
  }
  const handleBlockTag = (_value: string) => {
    setBlockTag(_value)
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Address</label>
        <TextInput
          value={address}
          onChange={handleAddressChange}
          placeholder='0x'
        />
        <label>Block number (optional)</label>
        <TextInput
          value={blockTag}
          onChange={handleBlockTag}
          placeholder='latest'
          disabled={pending}
        />
        <label>
          <input
            type='checkbox'
            checked={pending}
            onChange={updateBlockTagCheck}
          />
          pending
        </label>
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get nonce</button>
        </div>
      </form>
      <div>
        {nonce !== null && (
          <pre>
            {nonce} ({intToHex(nonce)})
          </pre>
        )}
      </div>
    </div>
  )
}

function EnsResolver (props: any) {
  const { provider } = props
  const [loading, setLoading] = useState<boolean>(false)
  const [value, setValue] = useState<string>(
    localStorage.getItem('ensResolver' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('ensResolver', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const encode = async () => {
    try {
      setResult(null)
      setLoading(true)
      const resolved = await provider.resolveName(value)
      setResult(resolved)
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    encode()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>ENS name</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='vitalik.eth'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>resolve</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>
        {loading && <span>Loading...</span>}
        {result}
      </div>
    </div>
  )
}

function EnsReverseResolver (props: any) {
  const { provider } = props
  const [loading, setLoading] = useState<boolean>(false)
  const [value, setValue] = useState<string>(
    localStorage.getItem('ensReverseResolver' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('ensReverseResolver', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const encode = async () => {
    try {
      setResult(null)
      setLoading(true)
      const resolved = await provider.lookupAddress(value)
      setResult(resolved)
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    encode()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Address</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='0x123...'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>resolve</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>
        {loading && <span>Loading...</span>}
        {result}
      </div>
    </div>
  )
}

function EnsAvatar (props: any) {
  const { provider } = props
  const [loading, setLoading] = useState<boolean>(false)
  const [value, setValue] = useState<string>(
    localStorage.getItem('ensAvatar' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('ensAvatar', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const encode = async () => {
    try {
      setResult(null)
      setLoading(true)
      let ensName = value
      if (utils.isAddress(value)) {
        ensName = await provider.lookupAddress(value)
      }
      const url = await provider.getAvatar(ensName)
      setResult(url)
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    encode()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>ENS avatar (enter ens name or address)</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='vitalik.eth'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get avatar</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>
        {loading && <span>Loading...</span>}
        {!!result && (
          <img src={result} alt='avatar' style={{ maxWidth: '200px' }} />
        )}
      </div>
    </div>
  )
}

function HexCoder (props: any) {
  const [value, setValue] = useState(
    localStorage.getItem('hexCoderValue' || '')
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('hexCoderValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const convert = () => {
    try {
      setResult(null)
      if (value?.startsWith('0x')) {
        setResult(BigNumber.from(value).toString())
      } else {
        setResult(BigNumber.from(value).toHexString())
      }
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    convert()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Hex or number</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='0x123'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>convert</button>
        </div>
      </form>
      <div>{result !== null && <pre>{result}</pre>}</div>
    </div>
  )
}

function Base58Coder (props: any) {
  const [encodeValue, setEncodeValue] = useState(
    localStorage.getItem('base58EncodeValue' || '')
  )
  const [decodeValue, setDecodeValue] = useState(
    localStorage.getItem('base58DecodeValue' || '')
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('base58EncodeValue', encodeValue || '')
  }, [encodeValue])
  useEffect(() => {
    localStorage.setItem('base58DecodeValue', decodeValue || '')
  }, [decodeValue])
  const handleEncodeValueChange = (_value: string) => {
    setEncodeValue(_value)
  }
  const handleDecodeValueChange = (_value: string) => {
    setDecodeValue(_value)
  }
  const encode = () => {
    try {
      setResult(null)
      let buf = Buffer.from(encodeValue || '')
      if (encodeValue?.startsWith('0x')) {
        buf = Buffer.from(encodeValue.replace(/^0x/, ''), 'hex')
      }
      const base58content = base58.encode(buf)
      setResult(base58content)
    } catch (err) {
      alert(err.message)
    }
  }
  const decode = () => {
    try {
      setResult(null)
      if (decodeValue) {
        const base58content = base58.decode(decodeValue)
        setResult(
          `0x${Buffer.from(base58content).toString('hex')}\n${Buffer.from(
            base58content
          ).toString()}`
        )
      }
    } catch (err) {
      alert(err.message)
    }
  }
  const handleEncodeSubmit = (event: any) => {
    event.preventDefault()
    encode()
  }
  const handleDecodeSubmit = (event: any) => {
    event.preventDefault()
    decode()
  }
  return (
    <div>
      <form onSubmit={handleEncodeSubmit}>
        <label>Encode value</label>
        <TextInput
          value={encodeValue}
          onChange={handleEncodeValueChange}
          placeholder='example.com'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>encode</button>
        </div>
      </form>
      <form onSubmit={handleDecodeSubmit}>
        <label>Decode value</label>
        <TextInput
          value={decodeValue}
          onChange={handleDecodeValueChange}
          placeholder='SAQDNQ7MfCiLqDE'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>decode</button>
        </div>
      </form>
      <div>{result !== null && <pre>{result}</pre>}</div>
    </div>
  )
}

function ClearLocalStorage () {
  const handleSubmit = (event: any) => {
    event.preventDefault()
    try {
      localStorage.clear()
      sessionStorage.clear()
      window.location.reload()
    } catch (err) {
      alert(err.message)
    }
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <button type='submit'>Clear local storage</button>
      </form>
    </div>
  )
}

function EnsCoder (props: any) {
  const [value, setValue] = useState<string>(
    localStorage.getItem('namehashValue' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('namehashValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const encode = () => {
    try {
      setResult(null)
      setResult(utils.namehash(value))
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    encode()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>ENS namehash (returns node)</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='vitalik.eth'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>encode</button>
        </div>
      </form>
      <div>{result !== null && <pre>{result}</pre>}</div>
    </div>
  )
}

function IPNSContentHash (props: any) {
  const [value, setValue] = useState<string>(
    localStorage.getItem('ipnsContentHashValue' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('ipnsContentHashValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const encode = () => {
    try {
      setResult(null)
      if (value) {
        const base58content = base58.encode(
          Buffer.concat([Buffer.from([0, value.length]), Buffer.from(value)])
        )
        const ensContentHash = `0x${contentHash.encode(
          'ipns-ns',
          base58content
        )}`
        setResult(ensContentHash)
      }
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    encode()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>IPNS ContentHash</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='app.example.com'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>encode</button>
        </div>
      </form>
      <div>{result !== null && <pre>{result}</pre>}</div>
    </div>
  )
}

function IpfsCoder (props: any) {
  const [v1Value, setV1Value] = useState<string>(
    localStorage.getItem('ipfsV1Value' || '') || ''
  )
  const [v0Value, setV0Value] = useState<string>(
    localStorage.getItem('ipfsV0Value' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('ipfsV1Value', v1Value || '')
  }, [v1Value])
  useEffect(() => {
    localStorage.setItem('ipfsV0Value', v0Value || '')
  }, [v0Value])
  const handleV1ValueChange = (_value: string = '') => {
    setV1Value(_value)
  }
  const handleV0ValueChange = (_value: string = '') => {
    setV0Value(_value)
  }
  const toV1 = () => {
    try {
      setResult(null)
      setResult(new CID(v0Value).toV1().toString('base16'))
    } catch (err) {
      alert(err.message)
    }
  }
  const toV0 = () => {
    try {
      setResult(null)
      setResult(new CID(v1Value).toV0().toString())
    } catch (err) {
      alert(err.message)
    }
  }
  const handleV0Submit = (event: any) => {
    event.preventDefault()
    toV0()
  }
  const handleV1Submit = (event: any) => {
    event.preventDefault()
    toV1()
  }
  return (
    <div>
      <form onSubmit={handleV1Submit}>
        <label>To V1</label>
        <TextInput
          value={v0Value}
          onChange={handleV0ValueChange}
          placeholder='QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>convert</button>
        </div>
      </form>
      <form onSubmit={handleV0Submit}>
        <label>To V0</label>
        <TextInput
          value={v1Value}
          onChange={handleV1ValueChange}
          placeholder='f017012209f668b20cfd24cdbf9e1980fa4867d08c67d2caf8499e6df81b9bf0b1c97287d'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>convert</button>
        </div>
      </form>
      <div>{result !== null && <pre>{result}</pre>}</div>
    </div>
  )
}

// more info: https://github.com/ensdomains/ens-app/issues/849#issuecomment-777088950
// ens public resolver: 0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41
function ContentHashCoder (props: any) {
  const [shouldBase58EncodeContent, setShouldBase58EncodeContent] = useState<
    boolean
  >(false)
  const [encodeValue, setEncodeValue] = useState<string>(
    localStorage.getItem('contentHashEncodeValue' || '') || ''
  )
  const [decodeValue, setDecodeValue] = useState<string>(
    localStorage.getItem('contentHashDecodeValue' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('contentHashEncodeValue', encodeValue || '')
  }, [encodeValue])
  useEffect(() => {
    localStorage.setItem('contentHashDecodeValue', decodeValue || '')
  }, [decodeValue])
  const handleEncodeValueChange = (_value: string = '') => {
    setEncodeValue(_value)
  }
  const handleDecodeValueChange = (_value: string = '') => {
    setDecodeValue(_value)
  }
  const encode = () => {
    try {
      setResult(null)
      const matched =
        encodeValue.match(
          /^(ipfs-ns|ipfs|ipns|ipns-ns|bzz|onion|onion3):\/\/(.*)/
        ) ||
        encodeValue.match(/\/(ipfs)\/(.*)/) ||
        encodeValue.match(/\/(ipns)\/(.*)/)
      if (!matched) {
        throw new Error('could not encode (missing protocol)')
      }

      const contentType = matched[1]
      const content = matched[2]
      let base58content = content

      if (shouldBase58EncodeContent) {
        base58content = base58.encode(
          Buffer.concat([
            Buffer.from([0, content.length]),
            Buffer.from(content)
          ])
        )
      }

      console.log('contentType:', contentType)
      console.log('base58Content:', base58content)

      let ensContentHash = ''
      if (shouldBase58EncodeContent) {
        ensContentHash = contentHash.encode(contentType, base58content)
      } else {
        ensContentHash = contentHash2.encode(contentType, base58content)
      }
      ensContentHash = `0x${ensContentHash}`
      setResult(ensContentHash)
    } catch (err) {
      alert(err.message)
    }
  }
  const decode = () => {
    try {
      setResult(null)
      const _value = decodeValue.replace('0x', '')
      setResult(
        `${contentHash2.getCodec(_value)}://${contentHash2.decode(_value)}`
      )
    } catch (err) {
      alert(err.message)
    }
  }
  const handleEncodeSubmit = (event: any) => {
    event.preventDefault()
    encode()
  }
  const handleDecodeSubmit = (event: any) => {
    event.preventDefault()
    decode()
  }
  const handleCheckboxChange = (event: any) => {
    setShouldBase58EncodeContent(event.target.checked)
  }
  return (
    <div>
      <form onSubmit={handleEncodeSubmit}>
        <label>
          Encode <small>(e.g. {`ipns-ns://<peer-id>`})</small>
        </label>
        <TextInput
          value={encodeValue}
          onChange={handleEncodeValueChange}
          placeholder='ipfs-ns://QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <input
            type='checkbox'
            checked={shouldBase58EncodeContent}
            onChange={handleCheckboxChange}
          />
          base58 encode content <small>(ie. using domain)</small>
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>encode</button>
        </div>
      </form>
      <form onSubmit={handleDecodeSubmit}>
        <label>Decode</label>
        <TextInput
          value={decodeValue}
          onChange={handleDecodeValueChange}
          placeholder='0xe301017012209f668b20cfd24cdbf9e1980fa4867d08c67d2caf8499e6df81b9bf0b1c97287d'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>decode</button>
        </div>
      </form>
      <div>{result !== null && <pre>{result}</pre>}</div>
    </div>
  )
}

function ChecksumAddress (props: any) {
  const [value, setValue] = useState<string>(
    localStorage.getItem('checksumAddressValue' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('checksumAddressValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const checksum = () => {
    try {
      setResult(null)
      if (!value) {
        return
      }
      setResult(utils.getAddress(value.trim()))
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    checksum()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Address</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='0x...'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>checksum</button>
        </div>
      </form>
      <div>{result}</div>
    </div>
  )
}

function PrivateKeyToAddress (props: any) {
  const [value, setValue] = useState<string>(
    localStorage.getItem('privateKeyToAddressValue' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('privateKeyToAddressValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const update = () => {
    try {
      setResult(null)
      if (!value) {
        return
      }
      setResult(privateKeyToAddress(value.trim().replace('0x', '')))
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    update()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Private key</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='0x...'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get address</button>
        </div>
      </form>
      <div>{result}</div>
    </div>
  )
}

function PrivateKeyToPublicKey (props: any) {
  const [value, setValue] = useState<string>(
    localStorage.getItem('privateKeyToPublicKeyValue' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('privateKeyToPublicKeyValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const update = () => {
    try {
      setResult(null)
      if (!value) {
        return
      }
      setResult(
        privateKeyToPublicKey(value.trim().replace('0x', '')).toString('hex')
      )
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    update()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Private key</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='0x...'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get public key</button>
        </div>
      </form>
      <div style={{ wordBreak: 'break-all' }}>{result}</div>
    </div>
  )
}

function PublicKeyToAddress (props: any) {
  const [value, setValue] = useState<string>(
    localStorage.getItem('publicKeyToAddressValue' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('publicKeyToAddressValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const update = () => {
    try {
      setResult(null)
      if (!value) {
        return
      }
      setResult(publicKeyToAddress(value.trim().replace('0x', '')))
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    update()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Public key</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='0x...'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get address</button>
        </div>
      </form>
      <div>{result}</div>
    </div>
  )
}

function BatchEthBalanceChecker (props: any) {
  const { provider } = props
  const [value, setValue] = useState<string>(
    localStorage.getItem('batchEthBalanceCheckerValue' || '') || ''
  )
  const [blockTag, setBlockTag] = useState<string>(
    localStorage.getItem('batchEthBalanceCheckerBlockTag' || '') || ''
  )
  const [result, setResult] = useState<string[]>([])
  useEffect(() => {
    localStorage.setItem('batchEthBalanceCheckerValue', value || '')
  }, [value])
  useEffect(() => {
    localStorage.setItem('batchEthBalanceCheckerBlockTag', blockTag || '')
  }, [blockTag])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const handleBlockTag = (_value: string) => {
    setBlockTag(_value)
  }

  const update = async () => {
    try {
      setResult([])
      if (!value) {
        return
      }
      const addresses = value
        .trim()
        .split('\n')
        .map((addr: string) => {
          return addr.trim()
        })
      const _result: string[] = []
      let total = BigNumber.from(0)
      let _blockTag: any = undefined
      if (blockTag) {
        if (!Number.isNaN(Number(blockTag))) {
          _blockTag = Number(blockTag)
        } else {
          _blockTag = blockTag
        }
      }
      for (const address of addresses) {
        const balance = await provider.getBalance(address, _blockTag)
        const output = `${address} ${utils.formatEther(balance)} ETH`
        total = total.add(balance)
        _result.push(output)
        setResult([..._result])
      }
      const { chainId, name } = await provider.getNetwork()
      const chainLabel =
        name !== 'unknown' ? `${name} ${chainId}` : `${chainId}`
      _result.push(
        `total: ${utils.formatEther(total)} ETH (chain ${chainLabel})`
      )
      setResult([..._result])
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    update()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>List of addresses</label>
        <TextInput
          variant='textarea'
          value={value}
          onChange={handleValueChange}
          placeholder='0x...'
        />
        <label>Block number (optional)</label>
        <TextInput
          value={blockTag}
          onChange={handleBlockTag}
          placeholder='latest'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get balances</button>
        </div>
      </form>
      <div>
        <pre>{result.join('\n')}</pre>
      </div>
    </div>
  )
}

function BatchTokenBalanceChecker (props: any) {
  const { provider } = props
  const [value, setValue] = useState<string>(
    localStorage.getItem('batchTokenBalanceCheckerValue' || '') || ''
  )
  const [tokenAddress, setTokenAddress] = useState<string>(
    localStorage.getItem('batchTokenBalanceCheckerTokenAddress' || '') || ''
  )
  const [result, setResult] = useState<string[]>([])
  const [blockTag, setBlockTag] = useState<string>(
    localStorage.getItem('batchTokenBalanceCheckerBlockTag' || '') || ''
  )
  useEffect(() => {
    localStorage.setItem('batchTokenBalanceCheckerValue', value || '')
  }, [value])
  useEffect(() => {
    localStorage.setItem(
      'batchTokenBalanceCheckerTokenAddress',
      tokenAddress || ''
    )
  }, [tokenAddress])
  useEffect(() => {
    localStorage.setItem('batchTokenBalanceCheckerBlockTag', blockTag || '')
  }, [blockTag])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const handleTokenAddressChange = (_value: string) => {
    setTokenAddress(_value)
  }
  const handleBlockTag = (_value: string) => {
    setBlockTag(_value)
  }
  const update = async () => {
    try {
      setResult([])
      if (!value) {
        return
      }
      const contract = new Contract(tokenAddress, nativeAbis.ERC20, provider)
      const [decimals, symbol] = await Promise.all([
        contract.decimals(),
        contract.symbol()
      ])
      const addresses = value
        .trim()
        .split('\n')
        .map((addr: string) => {
          return addr.trim()
        })
      const _result: string[] = []
      let total = BigNumber.from(0)
      let opts: any = {}
      if (blockTag) {
        let _blockTag: any = undefined
        if (!Number.isNaN(Number(blockTag))) {
          _blockTag = Number(blockTag)
        } else {
          _blockTag = blockTag
        }
        opts = { blockTag: _blockTag }
      }
      for (const address of addresses) {
        const balance = await contract.balanceOf(address, opts)
        const output = `${address} ${utils.formatUnits(
          balance,
          decimals
        )} ${symbol}`
        total = total.add(balance)
        _result.push(output)
        setResult([..._result])
      }
      const { chainId, name } = await provider.getNetwork()
      const chainLabel =
        name !== 'unknown' ? `${name} ${chainId}` : `${chainId}`
      _result.push(
        `total: ${utils.formatUnits(
          total,
          decimals
        )} ${symbol} (chain ${chainLabel})`
      )
      setResult([..._result])
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    update()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '0.5rem' }}>
          <label>Token address</label>
          <TextInput
            value={tokenAddress}
            onChange={handleTokenAddressChange}
            placeholder='0x...'
          />
        </div>
        <label>List of addresses</label>
        <TextInput
          variant='textarea'
          value={value}
          onChange={handleValueChange}
          placeholder='0x...'
        />
        <label>Block number (optional)</label>
        <TextInput
          value={blockTag}
          onChange={handleBlockTag}
          placeholder='latest'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get balances</button>
        </div>
      </form>
      <div>
        <pre>{result.join('\n')}</pre>
      </div>
    </div>
  )
}

function BatchZkSyncBalanceChecker (props: any) {
  const [value, setValue] = useState<string>(
    localStorage.getItem('batchZkSyncBalanceCheckerValue' || '') || ''
  )
  const [result, setResult] = useState<string[]>([])
  useEffect(() => {
    localStorage.setItem('batchZkSyncBalanceCheckerValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const update = async () => {
    try {
      setResult([])
      if (!value) {
        return
      }
      const syncProvider = await zksync.getDefaultProvider('mainnet')
      const addresses = value
        .trim()
        .split('\n')
        .map((addr: string) => {
          return addr.trim()
        })
      const _result: string[] = []
      for (const address of addresses) {
        const state = await syncProvider.getState(address)
        const balances = state.verified.balances
        const formatted: any = {}
        for (const token in balances) {
          if (tokenDecimals[token]) {
            formatted[token] = utils.formatUnits(
              balances[token],
              tokenDecimals[token]
            )
          } else {
            formatted[token] = `${balances[token]} (unformatted)`
          }
        }
        const output = `${address} ${JSON.stringify(formatted)}`
        _result.push(output)
        setResult([..._result])
      }
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    update()
  }
  return (
    <div>
      <div style={{ marginBottom: '0.5rem' }}>
        <label>mainnet only</label>
      </div>
      <form onSubmit={handleSubmit}>
        <label>List of addresses</label>
        <TextInput
          variant='textarea'
          value={value}
          onChange={handleValueChange}
          placeholder='0x...'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get balances</button>
        </div>
      </form>
      <div>
        <pre>{result.join('\n')}</pre>
      </div>
    </div>
  )
}

function BatchEnsReverseResolverChecker (props: any) {
  const { provider } = props
  const [value, setValue] = useState<string>(
    localStorage.getItem('batchEnsReverseResolverChecker' || '') || ''
  )
  const [result, setResult] = useState<string[]>([])
  useEffect(() => {
    localStorage.setItem('batchEnsReverseResolverChecker', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const update = async () => {
    try {
      setResult([])
      if (!value) {
        return
      }
      const addresses = value
        .trim()
        .split('\n')
        .map((addr: string) => {
          return addr.trim()
        })
      const _result: string[] = []
      for (const address of addresses) {
        const resolved = await provider.lookupAddress(address)
        const output = `${address}=${resolved}`
        _result.push(output)
        setResult([..._result])
      }
      setResult([..._result])
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    update()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>List of addresses</label>
        <TextInput
          variant='textarea'
          value={value}
          onChange={handleValueChange}
          placeholder='0x...'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>resolve</button>
        </div>
      </form>
      <div>
        <pre>{result.join('\n')}</pre>
      </div>
    </div>
  )
}

function HashMessage (props: any) {
  const [value, setValue] = useState<string>(
    localStorage.getItem('hashMessageValue' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('hashMessageValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const hash = async () => {
    try {
      setResult(null)
      const hashed = utils.hashMessage(value)
      setResult(hashed)
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    hash()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Message</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='message'
          variant='textarea'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>hash message</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>{result}</div>
    </div>
  )
}

function SignMessage (props: any) {
  const { wallet } = props
  const [loading, setLoading] = useState<boolean>(false)
  const [value, setValue] = useState<string>(
    localStorage.getItem('signMessageValue' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('signMessageValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const encode = async () => {
    try {
      setResult(null)
      setLoading(true)
      const signature = await wallet.signMessage(value)
      setResult(signature)
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    encode()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Message</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='message'
          variant='textarea'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>sign message</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>
        {loading && <span>waiting for wallet...</span>}
        {result}
      </div>
    </div>
  )
}

function VerifySignature (props: any) {
  const [hashMessage, setHashMessage] = useState<boolean>(
    localStorage.getItem('verifySignatureHashMessage') === 'true'
  )
  const [message, setMessage] = useState<string>(
    localStorage.getItem('verifySignatureMessage' || '') || ''
  )
  const [signature, setSignature] = useState<string>(
    localStorage.getItem('verifySignatureSignature' || '') || ''
  )
  const [address, setAddress] = useState<string>(
    localStorage.getItem('verifySignatureAddress' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('verifySignatureMessage', message || '')
  }, [message])
  useEffect(() => {
    localStorage.setItem('verifySignatureSignature', signature || '')
  }, [signature])
  useEffect(() => {
    localStorage.setItem('verifySignatureAddress', address || '')
  }, [address])
  useEffect(() => {
    localStorage.setItem('verifySignatureHashMessage', `${hashMessage || ''}`)
  }, [hashMessage])
  const handleMessageChange = (_value: string) => {
    setMessage(_value)
  }
  const handleSignatureChange = (_value: string) => {
    setSignature(_value)
  }
  const handleAddressChange = (_value: string) => {
    setAddress(_value)
  }
  const updateHashMessage = (event: any) => {
    const checked = event.target.checked
    setHashMessage(checked)
  }
  const recover = async () => {
    try {
      setResult(null)
      if (!message) {
        throw new Error('message is required')
      }
      if (!signature) {
        throw new Error('signature is required')
      }
      let _message = message
      if (hashMessage) {
        _message = utils.hashMessage(message)
      }
      const recoveredAddress = utils.recoverAddress(_message, signature)
      if (address) {
        const verified = recoveredAddress === utils.getAddress(address)
        setResult(`${verified}`)
      } else {
        setResult(recoveredAddress)
      }
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    recover()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Message</label>
        <TextInput
          value={message}
          onChange={handleMessageChange}
          placeholder='message'
          variant='textarea'
        />
        <div>
          <input
            type='checkbox'
            checked={hashMessage}
            onChange={updateHashMessage}
          />
          hash message
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <label>Signature</label>
          <TextInput
            value={signature}
            onChange={handleSignatureChange}
            placeholder='signature'
          />
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <label>Address</label>
          <TextInput
            value={address}
            onChange={handleAddressChange}
            placeholder='address'
          />
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>verify</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>{result}</div>
    </div>
  )
}

function SignTypedData (props: any) {
  const { wallet } = props
  const [loading, setLoading] = useState<boolean>(false)
  const [value, setValue] = useState<string>(
    localStorage.getItem('signTypedDataValue' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('signTypedDataValue', value || '')
  }, [value])
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const encode = async () => {
    try {
      setResult(null)
      setLoading(true)
      const json = JSON.parse(value)
      console.log('json:', json)
      const signature = await wallet._signTypedData(
        json.domain,
        json.types,
        json.value || json.message
      )
      setResult(signature)
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    encode()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Message</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='{ domain, types, value }'
          variant='textarea'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>sign typed message</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>
        {loading && <span>waiting for wallet...</span>}
        {result}
      </div>
    </div>
  )
}

const ERC20_ABI = [
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function nonces(address owner) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)'
]

async function signPermit ({
  tokenAddress,
  owner,
  spender,
  value,
  deadline,
  provider,
  signer
}: {
  tokenAddress: string
  owner: string
  spender: string
  value: string
  deadline: string
  provider: any
  signer: any
}) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider)

  const [name, nonce] = await Promise.all([token.name(), token.nonces(owner)])

  let version = 1
  try {
    version = await token.version()
  } catch (err) {}

  const domain = {
    name,
    version,
    chainId: (await provider.getNetwork()).chainId,
    verifyingContract: tokenAddress
  }

  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ]
  }

  const message = {
    owner,
    spender,
    value,
    nonce,
    deadline
  }

  const signature = await signer._signTypedData(domain, types, message)
  const { v, r, s } = ethers.utils.splitSignature(signature)

  return { v, r, s, signature }
}

function SignERC20Permit (props: any) {
  const { wallet } = props
  const [loading, setLoading] = useState<boolean>(false)
  const [token, setToken] = useState<string>(
    localStorage.getItem('signERC20PermitToken' || '') || ''
  )
  const [owner, setOwner] = useState<string>(
    localStorage.getItem('signERC20PermitOwner' || '') || ''
  )
  const [spender, setSpender] = useState<string>(
    localStorage.getItem('signERC20PermitSpender' || '') || ''
  )
  const [value, setValue] = useState<string>(
    localStorage.getItem('signERC20PermitValue' || '') || ''
  )
  const [deadline, setDeadline] = useState<string>(
    localStorage.getItem('signERC20PermitDeadline' || '') || ''
  )
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    localStorage.setItem('signERC20PermitToken', token || '')
  }, [token])
  useEffect(() => {
    localStorage.setItem('signERC20PermitOwner', owner || '')
  }, [owner])
  useEffect(() => {
    localStorage.setItem('signERC20PermitSpender', spender || '')
  }, [spender])
  useEffect(() => {
    localStorage.setItem('signERC20PermitValue', value || '')
  }, [value])
  useEffect(() => {
    localStorage.setItem('signERC20PermitDeadline', deadline || '')
  }, [deadline])
  const handleTokenChange = (_value: string) => {
    setToken(_value)
  }
  const handleOwnerChange = (_value: string) => {
    setOwner(_value)
  }
  const handleSpenderChange = (_value: string) => {
    setSpender(_value)
  }
  const handleValueChange = (_value: string) => {
    setValue(_value)
  }
  const handleDeadlineChange = (_value: string) => {
    setDeadline(_value)
  }
  const encode = async () => {
    try {
      setResult(null)
      setLoading(true)
      const permitData = await signPermit({
        tokenAddress: token,
        owner,
        spender,
        value,
        deadline,
        provider: wallet.provider,
        signer: wallet
      })

      setResult(JSON.stringify(permitData, null, 2))
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    encode()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Token</label>
        <TextInput
          value={token}
          onChange={handleTokenChange}
          placeholder='0x...'
        />
        <label>Owner</label>
        <TextInput
          value={owner}
          onChange={handleOwnerChange}
          placeholder='0x...'
        />
        <label>Spender</label>
        <TextInput
          value={spender}
          onChange={handleSpenderChange}
          placeholder='0x....'
        />
        <label>Value</label>
        <TextInput value={value} onChange={handleValueChange} placeholder='0' />
        <label>Deadline</label>
        <TextInput
          value={deadline}
          onChange={handleDeadlineChange}
          placeholder={`${Math.floor(Date.now() / 1000)}`}
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>sign permit</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>
        {loading && <span>waiting for wallet...</span>}
        {result}
      </div>
    </div>
  )
}

function EncryptMessage (props: any) {
  const provider = (window as any).ethereum
  const [value, setValue] = useState(localStorage.getItem('encryptValue') || '')
  const [result, setResult] = useState<any>('')
  useEffect(() => {
    localStorage.setItem('encryptValue', value || '')
  }, [value])
  async function getPublicKey () {
    const accounts = await provider.enable()
    const encryptionPublicKey = await provider.request({
      method: 'eth_getEncryptionPublicKey',
      params: [accounts[0]]
    })

    return encryptionPublicKey
  }
  async function encrypt (msg: string) {
    const encryptionPublicKey = await getPublicKey()
    const buf = Buffer.from(
      JSON.stringify(
        sigUtil.encrypt(
          encryptionPublicKey,
          { data: msg },
          'x25519-xsalsa20-poly1305'
        )
      ),
      'utf8'
    )

    return '0x' + buf.toString('hex')
  }

  async function encryptHandler () {
    try {
      setResult('')
      const encMsg = await encrypt(value)
      setResult(encMsg)
    } catch (err) {
      alert(err.message)
      console.error(err)
    }
  }
  const handleValueChange = (value: string) => {
    setValue(value)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    encryptHandler()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Message to encrypt with public key</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='message'
          variant='textarea'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>encrypt</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>{result}</div>
    </div>
  )
}

function DecryptMessage (props: any) {
  const provider = (window as any).ethereum
  const [value, setValue] = useState(localStorage.getItem('decryptValue') || '')
  const [result, setResult] = useState<any>('')
  useEffect(() => {
    localStorage.setItem('decryptValue', value || '')
  }, [value])

  async function decrypt (encMsg: string) {
    const accounts = await provider.enable()
    const decMsg = await provider.request({
      method: 'eth_decrypt',
      params: [encMsg, accounts[0]]
    })

    return decMsg
  }

  async function decryptHandler () {
    try {
      setResult('')
      const decMsg = await decrypt(value)
      setResult(decMsg)
    } catch (err) {
      alert(err.message)
      console.error(err)
    }
  }
  const handleValueChange = (value: string) => {
    setValue(value)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    decryptHandler()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Encrypted message to decrypt with private key (hex)</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='0x...'
          variant='textarea'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>decrypt</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>{result}</div>
    </div>
  )
}

function GasCostCalculator (props: any) {
  const { provider } = props
  const defaultGasLimit = '21000'
  const [ethUsdPrice, setEthUsdPrice] = useState(
    localStorage.getItem('gasCostCalculatorEthUsdPrice') || ''
  )
  const [gasPrice, setGasPrice] = useState(
    localStorage.getItem('gasCostCalculatorGasPrice') || ''
  )
  const [gasLimit, setGasLimit] = useState(
    localStorage.getItem('gasCostCalculatorGasLimit') || defaultGasLimit
  )
  const [resultEth, setResultEth] = useState<any>('')
  const [resultUsd, setResultUsd] = useState<any>('')
  const [isWei, setIsWei] = useState<any>(
    localStorage.getItem('gasCostCalculatorIsWei') === 'true'
  )
  const [usingCustomGasPrice, setUsingCustomGasPrice] = useState(false)
  const [usingCustomEthUsdPrice, setUsingCustomEthUsdPrice] = useState(false)
  useEffect(() => {
    localStorage.setItem('gasCostCalculatorEthUsdPrice', ethUsdPrice || '')
  }, [ethUsdPrice])
  useEffect(() => {
    localStorage.setItem('gasCostCalculatorGasPrice', gasPrice || '')
  }, [gasPrice])
  useEffect(() => {
    localStorage.setItem('gasCostCalculatorGasLimit', gasLimit || '')
  }, [gasLimit])
  useEffect(() => {
    localStorage.setItem('gasCostCalculatorIsWei', isWei)
  }, [isWei])

  useEffect(() => {
    async function getGasPrice () {
      try {
        const _gasPrice = await provider.getGasPrice()
        if (!gasPrice && !usingCustomGasPrice) {
          setGasPrice(utils.formatUnits(_gasPrice.toString(), 9))
        }
      } catch (err) {}
    }
    getGasPrice().catch(console.error)
  }, [provider, gasPrice, usingCustomGasPrice])

  useEffect(() => {
    async function getEthUsdPrice () {
      try {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
        )
        const json = await res.json()
        const _ethUsdPrice = json.ethereum.usd.toString()
        if (!ethUsdPrice && !usingCustomEthUsdPrice) {
          setEthUsdPrice(_ethUsdPrice)
        }
      } catch (err) {}
    }
    getEthUsdPrice().catch(console.error)
  }, [provider, ethUsdPrice, usingCustomEthUsdPrice])

  const calculate = useCallback(async () => {
    try {
      setResultEth('')
      setResultUsd('')
      const _gasPrice = Number(gasPrice)
      const _gasLimit = Number(gasLimit)
      const _ethUsdPrice = Number(ethUsdPrice)
      const _estimateEth = (_gasPrice * _gasLimit).toFixed(isWei ? 18 : 9)
      const estimateEth = utils.formatUnits(
        utils.parseUnits(_estimateEth, isWei ? 0 : 9),
        18
      )
      const _estimateUsd = (_gasPrice * _gasLimit * _ethUsdPrice).toFixed(
        isWei ? 18 : 9
      )
      const estimateUsd = utils.formatUnits(
        utils.parseUnits(_estimateUsd.toString(), isWei ? 0 : 9),
        18
      )
      setResultEth(estimateEth)
      setResultUsd(estimateUsd)
    } catch (err) {
      alert(err.message)
      console.error(err)
    }
  }, [ethUsdPrice, gasPrice, gasLimit, isWei])

  useEffect(() => {
    if (
      !usingCustomGasPrice &&
      !usingCustomEthUsdPrice &&
      gasPrice &&
      ethUsdPrice &&
      gasLimit === defaultGasLimit
    ) {
      calculate()
    }
  }, [
    usingCustomGasPrice,
    usingCustomEthUsdPrice,
    gasPrice,
    ethUsdPrice,
    gasLimit,
    calculate
  ])

  async function reset (event: any) {
    event.preventDefault()
    setEthUsdPrice('')
    setGasPrice('')
    setGasLimit(defaultGasLimit)
    setResultEth('')
    setResultUsd('')
    setUsingCustomGasPrice(false)
    setUsingCustomEthUsdPrice(false)
  }

  const updateInputType = (event: any) => {
    const { value } = event.target
    setIsWei(value === 'wei')
  }

  const handleEthUsdPriceChange = (value: string) => {
    setEthUsdPrice(value)
    setUsingCustomEthUsdPrice(true)
  }
  const handleGasPriceChange = (value: string) => {
    setGasPrice(value)
    setUsingCustomGasPrice(true)
  }
  const handleGasLimitChange = (value: string) => {
    setGasLimit(value)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    calculate()
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>ETH/USD</label>
        <TextInput
          value={ethUsdPrice}
          onChange={handleEthUsdPriceChange}
          placeholder='1500'
        />
        <label>
          Gas price (
          <span style={{ display: 'inline-block', marginRight: '0.5rem' }}>
            <input
              type='radio'
              value='gwei'
              checked={!isWei}
              onChange={updateInputType}
            />
            gwei
          </span>
          <span>
            <input
              type='radio'
              value='wei'
              checked={isWei}
              onChange={updateInputType}
            />
            wei
          </span>
          )
        </label>
        <TextInput
          value={gasPrice}
          onChange={handleGasPriceChange}
          placeholder='22'
        />
        <label>Gas required (gasLimit)</label>
        <TextInput
          value={gasLimit}
          onChange={handleGasLimitChange}
          placeholder='21000'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>calculate</button>
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <button onClick={reset}>reset</button>
        </div>
      </form>
      <div style={{ marginTop: '1rem' }}>Gas cost (ETH): {resultEth}</div>
      <div style={{ marginTop: '1rem' }}>Gas cost (USD): {resultUsd}</div>
    </div>
  )
}

function MethodSignatureGenerator (props: any) {
  const [value, setValue] = useState(
    localStorage.getItem('methodSignatureGeneratorValue') || ''
  )
  const [result, setResult] = useState<any>(null)
  const [normalizeValue, setNormalizedValue] = useState<any>('')
  useEffect(() => {
    localStorage.setItem('methodSignatureGeneratorValue', value || '')
  }, [value])
  const handleValueChange = (value: string) => {
    setValue(value)
  }
  const update = async () => {
    try {
      setResult(null)
      setNormalizedValue('')
      if (!value) {
        throw new Error('value is required')
      }
      let _value = value.trim()
      _value = _value.replace(/^(function|event)/gi, '')
      const fnName = _value.split('(')[0].trim()
      _value = _value.replace(/.*?\((.*?)\).*/gi, '$1')
      const parts = _value.split(',')
      let args = []
      for (const part of parts) {
        args.push(
          part
            .split(/\s+/)
            .filter(x => x)[0]
            .trim()
        )
      }
      _value = `${fnName}(${args.join(',')})`
      const res = `0x${(window as any).keccak256(_value).toString('hex')}`
      setNormalizedValue(_value)
      setResult(res)
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    update()
  }

  let output = ''
  if (result) {
    output = `input:${normalizeValue}\nbyte4: ${result.slice(
      0,
      10
    )}\nbytes32:${result}`
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Method or Event signature</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='transfer(address,uint256)'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get hash</button>
        </div>
      </form>
      <div>
        <pre>{output}</pre>
      </div>
    </div>
  )
}

function FourByteDictionary (props: any) {
  const [value, setValue] = useState(
    localStorage.getItem('fourByteValue') || ''
  )
  const [result, setResult] = useState<any>(null)
  useEffect(() => {
    localStorage.setItem('fourByteValue', value || '')
  }, [value])
  const handleValueChange = (value: string) => {
    setValue(value)
  }
  const update = async () => {
    try {
      setResult(null)
      if (!value) {
        throw new Error('method signature is required')
      }
      const res = await fourByte(value)
      setResult(res)
    } catch (err) {
      alert(err.message)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    update()
  }
  const output = JSON.stringify(result, null, 2)
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Method signature</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder='0xaabbccdd'
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>find</button>
        </div>
      </form>
      <div>
        <pre>{output}</pre>
      </div>
    </div>
  )
}

function DeployERC20 (props: any) {
  const { wallet } = props
  const [name, setName] = useState(
    localStorage.getItem('deployERC20Name') || ''
  )
  const [symbol, setSymbol] = useState(
    localStorage.getItem('deployERC20Symbol') || ''
  )
  const [decimals, setDecimals] = useState(
    localStorage.getItem('deployERC20Decimals') || '18'
  )
  const [initialSupply, setInitialSupply] = useState(
    localStorage.getItem('deployERC20InitialSupply') || ''
  )
  const [result, setResult] = useState<any>(null)
  useEffect(() => {
    localStorage.setItem('deployERC20Name', name || '')
  }, [name])
  useEffect(() => {
    localStorage.setItem('deployERC20Symbol', symbol || '')
  }, [symbol])
  useEffect(() => {
    localStorage.setItem('deployERC20Decimals', decimals || '')
  }, [decimals])
  useEffect(() => {
    localStorage.setItem('deployERC20InitialSupply', initialSupply || '')
  }, [initialSupply])
  const handleNameChange = (value: string) => {
    setName(value)
  }
  const handleSymbolChange = (value: string) => {
    setSymbol(value)
  }
  const handleDecimalsChange = (value: string) => {
    setDecimals(value)
  }
  const handleInitialSupplyChange = (value: string) => {
    setInitialSupply(value)
  }
  async function deploy () {
    try {
      setResult(null)
      if (!name) {
        throw new Error('name is required')
      }
      if (!symbol) {
        throw new Error('symbol is required')
      }
      if (!decimals) {
        throw new Error('decimals is required')
      }
      if (!wallet) {
        throw new Error('expected signer')
      }
      let factory: any
      const chainId = Number(await wallet.getChainId())
      const useZkSync = [324, 300].includes(chainId)
      if (useZkSync) {
        factory = new ZkSyncContractFactory(
          ZkSyncCustomERC20Artifact.abi,
          ZkSyncCustomERC20Artifact.bytecode,
          new ZkSyncWeb3Provider((window as any).ethereum, 'any').getSigner()
        )
      } else {
        factory = new ContractFactory(
          CustomERC20Artifact.abi,
          CustomERC20Artifact.bytecode,
          wallet
        )
      }
      setResult('deploying...')
      const contract = await factory.deploy(
        name,
        symbol,
        utils.parseUnits(initialSupply || '0', decimals)
      )
      const receipt = await contract.deployTransaction.wait()
      setResult(JSON.stringify(receipt, null, 2))
    } catch (err) {
      setResult(null)
      alert(err.message)
      console.error(err)
    }
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    deploy()
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Name (string) *</label>
          <TextInput
            value={name}
            onChange={handleNameChange}
            placeholder='MyToken'
          />
        </div>
        <div>
          <label>Symbol (string) *</label>
          <TextInput
            value={symbol}
            onChange={handleSymbolChange}
            placeholder='TKN'
          />
        </div>
        <div>
          <label>Decimals (uint256) *</label>
          <TextInput
            value={decimals}
            onChange={handleDecimalsChange}
            readOnly={true}
            placeholder='18'
          />
        </div>
        <div>
          <label>Initial Supply (uint256)</label>
          <TextInput
            value={initialSupply}
            onChange={handleInitialSupplyChange}
            placeholder='1000'
          />
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>Deploy</button>
        </div>
      </form>
      <div>
        <pre>{result}</pre>
      </div>
    </div>
  )
}

function GetBlockNumberFromDate (props: any) {
  const { provider } = props
  const [loading, setLoading] = useState<boolean>(false)
  const [value, setValue] = useState(
    localStorage.getItem('getBlockNumberFromDateValue') || ''
  )
  const [result, setResult] = useState<any>(null)
  useEffect(() => {
    localStorage.setItem('getBlockNumberFromDateValue', value || '')
  }, [value])
  const handleValueChange = (value: string) => {
    setValue(value)
  }
  const update = async () => {
    try {
      setResult(null)
      if (!value) {
        throw new Error('method signature is required')
      }

      setLoading(true)
      const blockDater = new BlockDater(provider)
      const date = DateTime.fromSeconds(Number(value)).toJSDate()
      const info = await blockDater.getDate(date)
      if (!info) {
        throw new Error('could not retrieve block number')
      }

      const blockNumber = info.block
      setResult(blockNumber.toString())
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }
  const handleSubmit = (event: any) => {
    event.preventDefault()
    update()
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>Unix timestamp (seconds)</label>
        <TextInput
          value={value}
          onChange={handleValueChange}
          placeholder={`${Math.floor(Date.now() / 1000)}`}
        />
        <div style={{ marginTop: '0.5rem' }}>
          <button type='submit'>get block number</button>
        </div>
      </form>
      <div>
        {loading && <span>Loading...</span>}
        <pre>{result}</pre>
      </div>
    </div>
  )
}

function App () {
  const [useWeb3, setUseWeb3] = useState<boolean>(() => {
    const cached = localStorage.getItem('useWeb3')
    if (cached) {
      return cached === 'true'
    }
    return true
  })
  const [privateKey, setPrivateKey] = useState(() => {
    return localStorage.getItem('privateKey') || ''
  })
  const [networkName, setNetworkName] = useState('')
  const [networkId, setNetworkId] = useState('')
  const [networkOption, setNetworkOption] = useState(() => {
    return localStorage.getItem('networkOption') || 'mainnet'
  })
  const [rpcProviderUrl, setRpcProviderUrl] = useState<string>(() => {
    return localStorage.getItem('rpcProviderUrl') || ''
  })
  const [rpcProvider, setRpcProvider] = useState<providers.Provider>(() => {
    try {
      const net = localStorage.getItem('networkOption') || 'mainnet'
      const url = localStorage.getItem('rpcProviderUrl')
      if (url) {
        return new providers.StaticJsonRpcProvider(
          url.replace('{network}', net)
        )
      }

      if (net === 'injected' && (window as any).ethereum) {
        return new providers.Web3Provider((window as any).ethereum, 'any')
      }

      return providers.getDefaultProvider(net)
    } catch (err) {
      console.error(err)
    }

    return providers.getDefaultProvider('mainnet')
  })
  const [wallet, setWallet] = useState<any>(rpcProvider)
  const [walletAddress, setWalletAddress] = useState<string>('')
  const [contractAddress, setContractAddress] = useState(() => {
    return localStorage.getItem('contractAddress') || ''
  })
  const [contractAddressLabel, setContractAddressLabel] = useState('')
  const [savedContractAddresses, setSavedContractAddresses] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('savedContractAddresses') || '')
    } catch (err) {
      return []
    }
  })
  const [newAbiName, setNewAbiName] = useState('')
  const [abiMethodFormShown, showAbiMethodForm] = useState(false)
  const [selectedAbi, setSelectedAbi] = useState(() => {
    const selected = localStorage.getItem('selectedAbi')
    return selected || 'ERC20'
  })
  const [customAbis, setCustomAbis] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem('customAbis') || '') || {}
    } catch (err) {
      return {}
    }
  })
  const [customAbi, setCustomAbi] = useState(() => {
    return localStorage.getItem('customAbi') || '[]'
  })
  const [abis, setAbis] = useState<any>(() => {
    return { ...nativeAbis, ...customAbis }
  })
  const [abi, setAbi] = useState(() => {
    const selected = localStorage.getItem('selectedAbi') || Object.keys(abis)[0]
    return (abis as any)[selected]
  })
  const [abiOptions, setAbiOptions] = useState(() => {
    return Object.keys(abis)
  })
  const [selectedAbiMethod, setSelectedAbiMethod] = useState(() => {
    return localStorage.getItem('selectedAbiMethod') || 'transfer'
  })
  const [selectedAbiEvent, setSelectedAbiEvent] = useState(() => {
    return localStorage.getItem('selectedAbiEvent') || 'Transfer'
  })
  const [connectedChainId, setConnectedChainId] = useState<string | undefined>()
  const [connectedAccounts, setConnectedAccounts] = useState<
    string[] | undefined
  >()
  useEffect(() => {
    if ((window as any).ethereum) {
      ;(window as any).ethereum.on('chainChanged', (chainId: string) => {
        setConnectedChainId(chainId)
      })
      ;(window as any).ethereum.on('accountsChanged', (accounts: string[]) => {
        setConnectedAccounts(accounts)
      })
    }
  }, [])
  useEffect(() => {
    ;(window as any).provider = rpcProvider
    setNetworkName('')
    setNetworkId('')
    rpcProvider
      .getNetwork()
      .then((network: any) => {
        setNetworkName(network?.name)
        setNetworkId(network?.chainId)
      })
      .catch(() => {})
  }, [rpcProvider, connectedChainId])
  useEffect(() => {
    ;(window as any).wallet = wallet

    const updateWalletAddress = async () => {
      setWalletAddress('')
      try {
        let signer: Signer = wallet
        if (wallet.getSigner) {
          signer = await wallet.getSigner()
        }
        if (signer?.getAddress) {
          const address = await signer.getAddress()
          setWalletAddress(address)
        }
      } catch (err) {
        console.error(err)
      }
    }
    updateWalletAddress()
  }, [wallet])
  useEffect(() => {
    try {
      if (useWeb3) {
        if ((window as any).ethereum) {
          const provider = new providers.Web3Provider(
            (window as any).ethereum,
            'any'
          )
          const signer = provider.getSigner()
          setWallet(signer)
        } else {
          alert('window.web3 not found')
        }
      } else {
        if (privateKey) {
          const priv = privateKey.replace(/^(0x)?/, '0x')
          const wal = new Wallet(priv, rpcProvider)
          setWallet(wal)
        } else {
          setWallet(null)
        }
      }
    } catch (err) {
      console.error(err)
    }
  }, [useWeb3, privateKey, rpcProvider, connectedChainId, connectedAccounts])
  useEffect(() => {
    const selected = (abis as any)[selectedAbi]
    if (selected) {
      setAbi(JSON.stringify(selected, null, 2))
    }
  }, [selectedAbi, abis])
  useEffect(() => {
    const _abis = { ...nativeAbis, ...customAbis }
    setAbis(_abis)
    setAbiOptions(Object.keys(_abis).sort())
  }, [customAbis])
  useEffect(() => {
    localStorage.setItem('selectedAbi', selectedAbi)
  }, [selectedAbi])
  const updateUseWeb3 = (event: any) => {
    const checked = event.target.checked
    localStorage.setItem('useWeb3', checked)
    setUseWeb3(checked)
  }
  const handleNetworkOptionChange = (value: string) => {
    setNetworkOption(value)
    localStorage.setItem('networkOption', value)
    if (rpcProviderUrl) {
      let url = rpcProviderUrl.replace('{network}', value)
      const provider = new providers.JsonRpcProvider(url)
      setRpcProvider(provider)
    } else if (value === 'injected') {
      const provider = new providers.Web3Provider(
        (window as any).ethereum,
        'any'
      )
      setRpcProvider(provider)
    } else {
      setRpcProvider(providers.getDefaultProvider(value))
    }
  }
  const handlePrivateKeyChange = (value: string) => {
    value = value.trim()
    setPrivateKey(value)
    localStorage.setItem('privateKey', value)
  }
  const handleRpcProviderUrlChange = (value: string) => {
    try {
      setRpcProviderUrl(value)
      localStorage.setItem('rpcProviderUrl', value)
      value = value.replace('{network}', networkOption)
      const provider = new providers.JsonRpcProvider(
        value.replace('{network}', networkOption)
      )
      setRpcProvider(provider)
    } catch (err) {
      // noop
    }
  }
  const handleContractAddressChange = (value: string) => {
    value = value.trim()
    if (value) {
      try {
        value = utils.getAddress(value)
      } catch (err) {
        // noop
      }
    }
    setContractAddress(value)
    localStorage.setItem('contractAddress', value)
  }
  const handleContractAddressLabelChange = (value: string) => {
    setContractAddressLabel(value)
  }
  const handleAbiSelectChange = (value: string) => {
    setSelectedAbi(value)
    const method =
      abis?.[value]?.find((x: any) => x?.type === 'function')?.name ?? ''
    setSelectedAbiMethod(method)
    const abiEvent =
      abis?.[value]?.find((x: any) => x?.type === 'event')?.name ?? ''
    setSelectedAbiEvent(abiEvent)
  }
  const handleAbiContent = (value: string) => {
    setCustomAbi(value)
    localStorage.setItem('customAbi', value)
  }
  const handleAddAbiClick = (event: any) => {
    event.preventDefault()
    showAbiMethodForm(true)
    setCustomAbi('')
  }
  const handleDeleteAbiClick = (event: any) => {
    event.preventDefault()
    try {
      const _customAbis = Object.assign({}, customAbis)
      delete _customAbis[selectedAbi]
      localStorage.setItem('customAbis', JSON.stringify(_customAbis))
      setCustomAbis(_customAbis)
      setSelectedAbi(Object.keys(nativeAbis)[0])
    } catch (err) {
      alert(err)
    }
  }
  const handleSaveAbiClick = (event: any) => {
    event.preventDefault()
    try {
      if (!newAbiName) {
        throw new Error('ABI name is required')
      }
      if (!customAbi) {
        throw new Error('ABI content is required')
      }
      const name = newAbiName.trim()

      let abiJson: any
      try {
        abiJson = JSON.parse(customAbi.trim())
        if (!Array.isArray(abiJson)) {
          if (Array.isArray(abiJson.abi)) {
            abiJson = abiJson.abi
          }
        }
      } catch (err) {
        const abiMethods = customAbi
          .trim()
          .split('\n')
          .filter(x => x)

        const iface = new ethers.utils.Interface(abiMethods)
        let functionsJson = Object.values(iface.functions || {})

        functionsJson = functionsJson.map((x: any) => {
          const copy = JSON.parse(JSON.stringify(x))
          if (!copy) {
            return copy
          }
          if (Array.isArray(copy.inputs)) {
            for (let idx in copy.inputs) {
              for (let key in copy.inputs[idx]) {
                if (copy.inputs[idx][key] === null) {
                  delete copy.inputs[idx][key]
                }
              }
              delete copy.inputs[idx].baseType
              delete copy.inputs[idx]._isParamType
            }
          }
          delete copy.gas
          delete copy._isFragment
          return copy
        })

        const eventsJson = Object.values(iface.events || {})
        abiJson = functionsJson.concat(...(eventsJson as any))
      }

      const newAbi = {
        [name]: abiJson
      }
      const _customAbis = { ...customAbis, ...newAbi }
      localStorage.setItem('customAbis', JSON.stringify(_customAbis))
      setCustomAbis(_customAbis)
      showAbiMethodForm(false)
      setCustomAbi('')
      setNewAbiName('')
      setSelectedAbi(name)
      const method =
        abiJson?.find((x: any) => x?.type === 'function')?.name ?? ''
      setSelectedAbiMethod(method)
      const abiEvent =
        abiJson?.find((x: any) => x?.type === 'event')?.name ?? ''
      setSelectedAbiEvent(abiEvent)
    } catch (err) {
      alert(err)
    }
  }
  const handleCancelAbiClick = (event: any) => {
    event.preventDefault()
    showAbiMethodForm(false)
    setCustomAbi('')
    setNewAbiName('')
  }
  const handleNewAbiNameChange = (value: string) => {
    setNewAbiName(value)
  }

  const renderMethodSelect = () => {
    try {
      const parsed = JSON.parse(abi)
      const options = parsed
        .map((obj: any) => {
          let value = obj.type === 'function' ? obj.name : null
          let label = value
          if (value && obj.signature) {
            label = `${value} (${obj.signature})`
          }
          return {
            label,
            value
          }
        })
        .filter((x: any) => x.value)
      const handleChange = (value: string) => {
        setSelectedAbiMethod(value)
        localStorage.setItem('selectedAbiMethod', value)
      }
      return (
        <Select
          onChange={handleChange}
          selected={selectedAbiMethod}
          options={options}
        />
      )
    } catch (err) {}
  }
  const renderEventsSelect = () => {
    try {
      const parsed = JSON.parse(abi)
      const options = parsed
        .map((obj: any) => {
          let value = obj.type === 'event' ? obj.name : null
          let label = value
          if (value && obj.signature) {
            label = `${value} (${obj.signature})`
          }
          return {
            label,
            value
          }
        })
        .filter((x: any) => x.value)
      const handleChange = (value: string) => {
        setSelectedAbiEvent(value)
        localStorage.setItem('selectedAbiEvent', value)
      }
      if (!options.length) {
        return null
      }
      return (
        <Select
          onChange={handleChange}
          selected={selectedAbiEvent}
          options={options}
        />
      )
    } catch (err) {}
  }
  const renderMethodForm = () => {
    try {
      const parsed = JSON.parse(abi)
      const filtered = parsed.filter((x: any) => x.name === selectedAbiMethod)
      if (!filtered.length) return null
      const obj = filtered[0]
      return (
        <AbiMethodForm
          key={obj.name}
          contractAddress={contractAddress}
          wallet={wallet}
          abi={obj}
          network={networkName}
        />
      )
    } catch (err) {
      // noop
    }
  }
  const renderEventForm = () => {
    try {
      const parsed = JSON.parse(abi)
      const filtered = parsed.filter((x: any) => x.name === selectedAbiEvent)
      if (!filtered.length) return null
      const obj = filtered[0]
      return (
        <AbiEventForm
          key={obj.name}
          abi={obj}
          contractAddress={contractAddress}
          provider={rpcProvider}
        />
      )
    } catch (err) {
      // noop
    }
  }

  const handleConnect = async (event: any) => {
    event.preventDefault()
    try {
      const windowWeb3 = (window as any).ethereum
      if (windowWeb3 && windowWeb3.enable) {
        await windowWeb3.enable()
      }
    } catch (err) {
      alert(err.message)
    }
  }

  function handleContractAddressLabelSave (event: any) {
    event.preventDefault()
    try {
      if (!contractAddress) {
        throw new Error('contract address is required')
      }
      if (!contractAddressLabel) {
        throw new Error('contract address label is required')
      }
      for (const item of savedContractAddresses) {
        if (contractAddress === item.contractAddress) {
          throw new Error('already exists')
        }
      }
      try {
        utils.getAddress(contractAddress)
      } catch (err) {
        throw new Error('invalid address')
      }
      setSavedContractAddresses([
        ...savedContractAddresses,
        {
          label: contractAddressLabel,
          contractAddress
        }
      ])
      setContractAddressLabel('')
    } catch (err) {
      alert(err.message)
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(
        'savedContractAddresses',
        JSON.stringify(savedContractAddresses)
      )
    } catch (err) {}
  }, [savedContractAddresses])

  function handleContractAddressSelect (event: any) {
    setContractAddress(event.target.value)
  }

  function handleContractAddressesClear () {
    try {
      setSavedContractAddresses([])
      localStorage.removeItem('savedContractAddresses')
    } catch (err) {}
  }

  return (
    <main>
      <header>
        <h1>Ethereum DevTools</h1>
      </header>
      <Fieldset legend='Network'>
        <section>
          <Select
            onChange={handleNetworkOptionChange}
            selected={networkOption}
            options={networkOptions}
          />
          <div>network: {networkName}</div>
          <div>chain ID: {networkId}</div>
        </section>
        <section>
          <label>
            RPC provider url{' '}
            <small>
              note: you can use "<code>{`{network}`}</code>" to replace network
              name
            </small>
          </label>
          <TextInput
            value={rpcProviderUrl}
            onChange={handleRpcProviderUrlChange}
          />
        </section>
      </Fieldset>
      <Fieldset legend='Signer'>
        <div>
          <input type='checkbox' checked={useWeb3} onChange={updateUseWeb3} />
          use web3
        </div>
        <section>
          <label>Private key</label>
          <TextInput
            disabled={useWeb3}
            value={privateKey}
            onChange={handlePrivateKeyChange}
          />
        </section>
        {!!walletAddress && (
          <section>
            <label>Address</label>
            <div>{walletAddress}</div>
          </section>
        )}
        <section>
          <button
            onClick={handleConnect}
            disabled={!useWeb3 || !!walletAddress}
          >
            Connect Wallet
          </button>
        </section>
      </Fieldset>
      <Fieldset legend='Contract'>
        <section>
          <label>Contract address</label>
          <TextInput
            value={contractAddress}
            onChange={handleContractAddressChange}
            placeholder='0x'
          />
          <TextInput
            value={contractAddressLabel}
            onChange={handleContractAddressLabelChange}
            placeholder='Label'
          />
          <div>
            <button onClick={handleContractAddressLabelSave}>Save</button>
          </div>
          {savedContractAddresses?.length > 0 && (
            <>
              <select
                onChange={handleContractAddressSelect}
                value={contractAddress}
              >
                {savedContractAddresses?.map((x: any) => {
                  return (
                    <option key={x.contractAddress} value={x.contractAddress}>
                      {x.label} - {x.contractAddress}
                    </option>
                  )
                })}
              </select>
              <button
                disabled={savedContractAddresses?.length === 0}
                onClick={handleContractAddressesClear}
              >
                Clear
              </button>
            </>
          )}
          {!!contractAddress && (
            <div style={{ marginTop: '1rem' }}>
              using contract address {contractAddress}
            </div>
          )}
        </section>
      </Fieldset>
      <Fieldset legend='ABI'>
        <section>
          <div>
            {abiMethodFormShown ? (
              <div style={{ display: 'flex' }}>
                <TextInput
                  value={newAbiName}
                  onChange={handleNewAbiNameChange}
                  placeholder={'ABI name'}
                />
                <button onClick={handleSaveAbiClick}>Save</button>
                <button onClick={handleCancelAbiClick}>Cancel</button>
              </div>
            ) : (
              <div style={{ marginBottom: '1rem' }}>
                <Select
                  onChange={handleAbiSelectChange}
                  selected={selectedAbi}
                  options={abiOptions}
                />
                <button onClick={handleAddAbiClick}>Add</button>
                {!(nativeAbis as any)[selectedAbi] ? (
                  <button onClick={handleDeleteAbiClick}>Delete</button>
                ) : null}
              </div>
            )}
          </div>
          {abiMethodFormShown && (
            <TextInput
              value={customAbi}
              onChange={handleAbiContent}
              variant='textarea'
              placeholder={`
Examples

function safeMint(address to, uint256 tokenId)
function ownerOf(uint256 tokenId) public returns (address)

or JSON ABI

[
  {
    "type": "function",
    "name": "safeMint",
    "constant": false,
    "inputs": [{ "name": "to", "type": "address" }, { "name": "tokenId", "type": "uint256" }],
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ownerOf",
    "constant": false,
    "inputs": [{ "name": "tokenId", "type": "uint256" }],
    "outputs": [{ "name": null, "type": "address", "baseType": "address" }],
    "payable": false,
    "stateMutability": "nonpayable"
  }
]
`.trim()}
            />
          )}
          {!abiMethodFormShown && (
            <div>
              <TextInput readOnly={true} value={abi} variant='textarea' />
            </div>
          )}
        </section>
      </Fieldset>
      <Fieldset legend='Method'>
        {!abiMethodFormShown && (
          <div style={{ marginBottom: '1rem' }}>{renderMethodSelect()}</div>
        )}
        {!abiMethodFormShown ? <section>{renderMethodForm()}</section> : null}
      </Fieldset>
      <Fieldset legend='Event'>
        {!abiMethodFormShown && (
          <div style={{ marginBottom: '1rem' }}>{renderEventsSelect()}</div>
        )}
        {!abiMethodFormShown ? <section>{renderEventForm()}</section> : null}
      </Fieldset>
      <Fieldset legend='Data decoder'>
        <section>
          <DataDecoder abi={abi} abiName={selectedAbi} />
        </section>
      </Fieldset>
      <Fieldset legend='Method and Event Topic Signature Generator'>
        <section>
          <MethodSignatureGenerator />
        </section>
      </Fieldset>
      <Fieldset legend='4byte dictionary'>
        <section>
          <FourByteDictionary />
        </section>
      </Fieldset>
      <Fieldset legend='Deploy ERC20'>
        <section>
          <DeployERC20 wallet={wallet} />
        </section>
      </Fieldset>
      <Fieldset legend='Send ETH'>
        <section>
          <SendEth wallet={wallet} />
        </section>
      </Fieldset>
      <Fieldset legend='Gas Cost Calculator'>
        <section>
          <GasCostCalculator provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Unit converter'>
        <section>
          <UnitConverter />
        </section>
      </Fieldset>
      <Fieldset legend='Custom transaction'>
        <section>
          <CustomTx wallet={wallet} network={networkName} />
        </section>
      </Fieldset>
      <Fieldset legend='Send raw transaction'>
        <section>
          <SendRawTx provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Get Gas Price'>
        <section>
          <GetGasPrice provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Get Gas Fee Data'>
        <section>
          <GetFeeData provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Get Transaction'>
        <section>
          <GetTx provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Get Transaction Receipt'>
        <section>
          <TxReceipt provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Get Block'>
        <section>
          <GetBlock provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Get block number from date'>
        <section>
          <GetBlockNumberFromDate provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Get code'>
        <section>
          <GetCode provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Get nonce'>
        <section>
          <GetNonce provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='ENS resolver'>
        <section>
          <EnsResolver provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='ENS reverse resolver'>
        <section>
          <EnsReverseResolver provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Get ENS avatar'>
        <section>
          <EnsAvatar provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Hex coder'>
        <section>
          <HexCoder />
        </section>
      </Fieldset>
      <Fieldset legend='Base58 coder'>
        <section>
          <Base58Coder />
        </section>
      </Fieldset>
      <Fieldset legend='ENS coder'>
        <section>
          <EnsCoder />
        </section>
      </Fieldset>
      <Fieldset legend='IPFS coder'>
        <section>
          <IpfsCoder />
        </section>
      </Fieldset>
      <Fieldset legend='ContentHash coder'>
        <section>
          <ContentHashCoder />
        </section>
      </Fieldset>
      <Fieldset legend='IPNS ContentHash'>
        <section>
          <IPNSContentHash />
        </section>
      </Fieldset>
      <Fieldset legend='Checksum Address'>
        <section>
          <ChecksumAddress />
        </section>
      </Fieldset>
      <Fieldset legend='Private Key to Address'>
        <section>
          <PrivateKeyToAddress />
        </section>
      </Fieldset>
      <Fieldset legend='Private Key to Public Key'>
        <section>
          <PrivateKeyToPublicKey />
        </section>
      </Fieldset>
      <Fieldset legend='Public Key to Address'>
        <section>
          <PublicKeyToAddress />
        </section>
      </Fieldset>
      <Fieldset legend='Hash Message'>
        <section>
          <HashMessage />
        </section>
      </Fieldset>
      <Fieldset legend='Sign Message'>
        <section>
          <SignMessage wallet={wallet} />
        </section>
      </Fieldset>
      <Fieldset legend='Verify signature'>
        <section>
          <VerifySignature />
        </section>
      </Fieldset>
      <Fieldset legend='Sign Typed Message EIP-712'>
        <section>
          <SignTypedData wallet={wallet} />
        </section>
      </Fieldset>
      <Fieldset legend='Sign ERC20 Permit EIP-2612'>
        <section>
          <SignERC20Permit wallet={wallet} />
        </section>
      </Fieldset>
      <Fieldset legend='Encrypt Message'>
        <section>
          <EncryptMessage />
        </section>
      </Fieldset>
      <Fieldset legend='Decrypt Message'>
        <section>
          <DecryptMessage />
        </section>
      </Fieldset>
      <Fieldset legend='Batch ETH Balance Checker'>
        <section>
          <BatchEthBalanceChecker provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Batch Token Balance Checker'>
        <section>
          <BatchTokenBalanceChecker provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Batch ZkSync Balance Checker'>
        <section>
          <BatchZkSyncBalanceChecker />
        </section>
      </Fieldset>
      <Fieldset legend='Batch ENS resolver checker'>
        <section>
          <BatchEnsReverseResolverChecker provider={rpcProvider} />
        </section>
      </Fieldset>
      <Fieldset legend='Keystore'>
        <section>
          <div>See:</div>
          <a
            href='https://lab.miguelmota.com/ethereum-keystore'
            target='_blank'
            rel='noopener noreferrer'
          >
            https://lab.miguelmota.com/ethereum-keystore
          </a>
        </section>
      </Fieldset>
      <Fieldset legend='HD Wallet'>
        <section>
          <div>See:</div>
          <a
            href='https://lab.miguelmota.com/ethereum-hdwallet'
            target='_blank'
            rel='noopener noreferrer'
          >
            https://lab.miguelmota.com/ethereum-hdwallet
          </a>
        </section>
      </Fieldset>
      <Fieldset legend='Clear'>
        <section>
          <ClearLocalStorage />
        </section>
      </Fieldset>
      <footer style={{ margin: '1rem 0' }}>
        © 2022{' '}
        <a
          href='https://github.com/miguelmota'
          target='_blank'
          rel='noopener noreferrer'
        >
          Miguel Mota
        </a>
      </footer>
    </main>
  )
}

export default App
