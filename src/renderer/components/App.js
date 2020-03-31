import React from 'react'
import Messenger from './Messenger'
import ChatList from './ChatList'
import MessageList from './MessageList'
import ChatInfoModal from './ChatInfoModal'
import SetupIdentityModal from './SetupIdentityModal'
import ImportPGPModal from './ImportPGPModal'
import CreatePGPModal from './CreatePGPModal'
import AddModal from './AddModal'
import { COMPOSE_CHAT_ID } from '../../consts'
import { ipcRenderer } from 'electron'
import '../../../static/css/*.css'

if (module.hot) {
  module.hot.accept()
}
// Initial modal state used to reset modals
const initModalsState = {
  setupIdentity: false,
  importPGP: false,
  createPGP: false,
  add: false,
  chatInfo: false,
  modalMessage: {
    text: '',
    longText: '',
    error: false
  }
}
// Validation regular expressions
const CIPHORA_ID_REGEX = /^[0-9a-fA-F]{40}$/
const WORDS_REGEX = /\S/
const PUBLIC_KEY_REGEX = /-----BEGIN PGP PUBLIC KEY BLOCK-----(.|\n|\r|\r\n)+-----END PGP PUBLIC KEY BLOCK-----/
const PRIVATE_KEY_REGEX = /-----BEGIN PGP PRIVATE KEY BLOCK-----(.|\n|\r|\r\n)+-----END PGP PRIVATE KEY BLOCK-----/m
// Makes PGP error messages user friendly
function friendlyError (error) {
  return error.message.slice(
    error.message.lastIndexOf('Error'),
    error.message.length
  )
}
// Makes a deep clone of an object
function clone (obj) {
  return JSON.parse(JSON.stringify(obj))
}

export default class App extends React.Component {
  constructor (props) {
    super(props)
    this.state = {
      chats: {},
      activeChatId: '',
      composing: false,
      ...clone(initModalsState)
    }

    this.closeModal = this.closeModal.bind(this)
    this.openModal = this.openModal.bind(this)
    this.importPGPHandler = this.importPGPHandler.bind(this)
    this.createPGPHandler = this.createPGPHandler.bind(this)
    this.addChatHandler = this.composeChatHandler.bind(this)
    this.deleteChatHandler = this.deleteChatHandler.bind(this)
    this.activateChat = this.activateChat.bind(this)
    this.sendMessage = this.sendMessage.bind(this)
    this.updateChats = this.updateChats.bind(this)
    this.handleModalError = this.handleModalError.bind(this)
    this.copyPGPHandler = this.copyPGPHandler.bind(this)
    this.onComposeChatHandler = this.createComposeChat.bind(this)
    this.deleteNewChat = this.deleteComposeChat.bind(this)
  }

  componentDidMount () {
    ipcRenderer.on('log', (event, data) => console.log(data))
    ipcRenderer.on('open-modal', (event, modal) => this.openModal(modal))
    ipcRenderer.on('update-chats', this.updateChats)
    ipcRenderer.on('modal-error', this.handleModalError)
  }

  updateChats (event, chats, activeChatId, closeModal) {
    if (closeModal) this.closeModal()
    let newState = { chats }
    if (activeChatId) newState = { activeChatId, ...newState }
    this.setState(newState)
  }

  closeModal () {
    this.setState({
      ...clone(initModalsState)
    })
  }

  openModal (name) {
    let newModalState = clone(initModalsState)
    newModalState[name] = true
    this.setState(newModalState)
  }

  handleModalError (event, text) {
    this.setState({
      modalMessage: {
        text,
        error: true
      }
    })
  }

  importPGPHandler (params) {
    const { keys, passphrase } = params
    let pub = keys.match(PUBLIC_KEY_REGEX)
    let priv = keys.match(PRIVATE_KEY_REGEX)

    if (!pub || !priv) {
      this.setState({
        modalMessage: {
          text: 'Missing or invalid details',
          error: true
        }
      })
      return
    }

    ipcRenderer
      .invoke('import-pgp', {
        passphrase,
        publicKeyArmored: pub[0],
        privateKeyArmored: priv[0]
      })
      .then(() => this.closeModal())
      .catch(error => {
        this.setState({
          modalMessage: {
            text: friendlyError(error),
            error: true
          }
        })
      })
  }

  createPGPHandler (params) {
    // Check if all required params supplied
    if (!params.name || !params.passphrase || !params.algo) {
      this.setState({
        modalMessage: {
          text: 'Missing details',
          error: true
        }
      })
      return
    }
    // Remove email if not supplied
    if (!params.email) delete params.email
    this.setState({
      modalMessage: {
        text: 'Generating keys...',
        error: false
      }
    })

    ipcRenderer
      .invoke('create-pgp', params)
      .then(({ publicKeyArmored, privateKeyArmored }) => {
        // Show generate keys
        this.setState({
          modalMessage: {
            longText: publicKeyArmored + '\n' + privateKeyArmored,
            text: '',
            error: false
          }
        })
      })
      .catch(error => {
        this.setState({
          modalMessage: {
            text: friendlyError(error),
            error: true
          }
        })
      })
  }

  createComposeChat () {
    // Already composing
    if (this.state.composing) return
    const id = COMPOSE_CHAT_ID
    // Create a dummy chat
    let chats = {}
    chats[id] = {
      id,
      name: 'New Chat',
      messages: []
    }
    // Add to the front
    chats = { ...chats, ...this.state.chats }
    this.setState({ composing: true, chats, activeChatId: id })
  }

  composeChatHandler (id) {
    let ciphoraId = id.match(CIPHORA_ID_REGEX)
    let pubKey = id.match(PUBLIC_KEY_REGEX)

    // Ensure id is either a valid CiphoraId or PGP public key
    if (!ciphoraId && !pubKey) {
      this.setState({
        modalMessage: {
          text: 'Invalid CiphoraId or PGP key',
          error: true
        }
      })
      return
    }

    this.setState({
      modalMessage: {
        text: 'Composing chat...',
        error: false
      }
    })

    ipcRenderer.send('add-chat', pubKey[0])
  }

  // Deletes the chat being composed
  deleteComposeChat () {
    let { chats } = this.state
    delete chats[COMPOSE_CHAT_ID]
    const nextChat = Object.values(chats)[0]
    const activeChatId = nextChat ? nextChat.id : ''
    this.setState({ composing: false, chats, activeChatId })
  }

  deleteChatHandler (id) {
    if (id === COMPOSE_CHAT_ID) {
      this.deleteComposeChat()
      return
    }
    // ipcRenderer.send('delete-chat', id)
  }

  copyPGPHandler () {
    this.closeModal()
    ipcRenderer.send('copy-pgp', this.state.activeChatId)
  }

  activateChat (chatId) {
    // Check if clicked chat already active
    if (chatId === this.state.activeChatId) {
      return
    }
    // Remove compose chat when user moves to another chat
    if (this.state.activeChatId === COMPOSE_CHAT_ID) {
      this.deleteComposeChat()
    }

    this.setState({ activeChatId: chatId })
    ipcRenderer.send('activate-chat', chatId)
  }

  sendMessage (message) {
    // Ensure message is not empty
    if (!message || !WORDS_REGEX.test(message)) return

    ipcRenderer.send('send-message', message, this.state.activeChatId)
  }

  // TODO: consistenly use 'compose' chat and message naming
  render () {
    const activeChat =
      this.state.activeChatId && this.state.chats[this.state.activeChatId]
    return (
      <div className='App'>
        <SetupIdentityModal
          open={this.state.setupIdentity}
          onImportPGPClick={() => this.openModal('importPGP')}
          onCreatePGPClick={() => this.openModal('createPGP')}
        />
        <ImportPGPModal
          open={this.state.importPGP}
          onClose={() => this.openModal('setupIdentity')}
          onImportClick={this.importPGPHandler}
          message={this.state.modalMessage}
        />
        <CreatePGPModal
          open={this.state.createPGP}
          onClose={() => this.openModal('setupIdentity')}
          onCreateClick={this.createPGPHandler}
          onDoneClick={this.closeModal}
          message={this.state.modalMessage}
        />
        <ChatInfoModal
          open={this.state.chatInfo}
          chat={activeChat}
          onClose={this.closeModal}
          onCopyPGPClick={this.copyPGPHandler}
          onDeleteClick={this.deleteChatHandler}
        />
        <AddModal
          open={this.state.add}
          onClose={this.closeModal}
          onAddClick={this.composeChatHandler}
          message={this.state.modalMessage}
        />
        <Messenger
          sidebar={
            <ChatList
              chats={Object.values(this.state.chats)}
              activeChatId={this.state.activeChatId}
              onChatClick={this.activateChat}
              onComposeClick={this.createComposeChat}
              onDeleteClick={this.deleteChatHandler}
            />
          }
          content={
            <MessageList
              composing={this.state.composing}
              onComposeChat={id => console.log(id)}
              chat={activeChat}
              onSend={this.sendMessage}
              onInfoClick={() => this.openModal('chatInfo')}
            />
          }
        />
      </div>
    )
  }
}