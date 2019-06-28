import EventEmitter from 'events'
import { convertNumberToHex } from '@walletconnect/utils'
import WalletConnect from '@walletconnect/browser'
import WCQRCode from '@walletconnect/qrcode-modal'
import {
  ISessionParams,
  IWalletConnectConnectionOptions
} from '@walletconnect/types'

const dev = process.env.NODE_ENV === 'development'

class WalletConnectConnection extends EventEmitter {
  public bridge: string
  public qrcode: boolean
  public infuraId: string
  public wc: WalletConnect | null = null
  public accounts: string[] = []
  public chainId: number = 1
  public networkId: number = 1
  public connected: boolean = false
  public closed: boolean = false

  constructor (opts: IWalletConnectConnectionOptions) {
    super()
    this.bridge = opts.bridge || 'https://bridge.walletconnect.org'
    this.qrcode = typeof opts.qrcode === 'undefined' || opts.qrcode !== false
    this.infuraId = opts.infuraId || ''
    this.on('error', () => this.close())
    setTimeout(() => this.create(opts), 0)
  }
  openQR () {
    const uri = this.wc ? this.wc.uri : ''
    if (uri) {
      WCQRCode.open(uri, () => {
        this.emit('error', new Error('User close WalletConnect QR Code modal'))
      })
    }
  }
  create (opts: any) {
    if (!WalletConnect) {
      this.emit('error', new Error('WalletConnect not available'))
    }

    try {
      this.wc = new WalletConnect({ bridge: opts.bridge })
    } catch (e) {
      this.emit('error', e)
      return
    }

    if (!this.wc.connected) {
      // Create new session
      this.wc
        .createSession()
        .then(() => {
          if (this.qrcode) this.openQR()
        })
        .catch((e: Error) => this.emit('error', e))
    }

    this.wc.on('connect', (err: Error | null, payload: any) => {
      if (err) {
        this.emit('error', err)
        return
      }

      this.connected = true

      if (this.qrcode) {
        WCQRCode.close() // Close QR Code Modal
      }

      // Handle session update
      this.updateState(payload.params[0])

      // Emit connect event
      this.emit('connect')
    })

    this.wc.on('session_update', (err: Error | null, payload: any) => {
      if (err) {
        this.emit('error', err)
        return
      }

      // Handle session update
      this.updateState(payload.params[0])
    })
    this.wc.on('disconnect', (err: Error | null, payload: any) => {
      if (err) {
        this.emit('error', err)
        return
      }
      this.onClose()
    })
  }
  onClose () {
    this.wc = null
    this.connected = false
    this.closed = true
    if (dev) console.log('Closing WalletConnector connection')
    this.emit('close')
    this.removeAllListeners()
  }
  close () {
    if (this.wc) {
      this.wc.killSession()
    }
    this.onClose()
  }
  error (payload: any, message: string, code = -1) {
    this.emit('payload', {
      id: payload.id,
      jsonrpc: payload.jsonrpc,
      error: { message, code }
    })
  }
  async send (payload: any) {
    const signingMethods = [
      'eth_sendTransaction',
      'eth_signTransction',
      'eth_sign',
      'eth_signTypedData',
      'eth_signTypedData_v1',
      'eth_signTypedData_v3',
      'personal_sign'
    ]
    const stateMethods = ['eth_accounts', 'eth_chainId', 'net_version']
    if (this.wc && this.wc.connected) {
      if (
        signingMethods.includes(payload.method) &&
        payload.method.includes('wallet_')
      ) {
        const response = await this.wc.unsafeSend(payload)
        this.emit('payload', response)
      } else if (stateMethods.includes(payload.method)) {
        const response = await this.handleStateMethods(payload)
        this.emit('payload', response)
      } else {
        this.error(
          payload,
          `JSON RPC method (${payload.method}) not supported by subprovider`
        )
      }
    } else {
      this.error(payload, 'Not connected')
    }
  }

  async handleStateMethods (payload: any) {
    let result: any = null
    switch (payload.method) {
      case 'eth_accounts':
        result = this.accounts
        break
      case 'eth_chainId':
        result = convertNumberToHex(this.chainId)
        break

      case 'net_version':
        result = this.networkId
        break
      default:
        break
    }
    return {
      id: payload.id,
      jsonrpc: payload.jsonrpc,
      result
    }
  }

  async updateState (sessionParams: ISessionParams) {
    const { accounts, chainId, networkId } = sessionParams

    // Check if accounts changed and trigger event
    if (accounts && this.accounts !== accounts) {
      this.accounts = accounts
      this.emit('accountsChanged', accounts)
    }

    // Check if chainId changed and trigger event
    if (chainId && this.chainId !== chainId) {
      this.chainId = chainId
      this.emit('chainChanged', chainId)
    }

    // Check if networkId changed and trigger event
    if (networkId && this.networkId !== networkId) {
      this.networkId = networkId
      this.emit('networkChanged', networkId)
    }
  }
}

export default WalletConnectConnection
