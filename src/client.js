import { AgentData } from '@web3-storage/access'
import { uploadFile, uploadDirectory } from '@web3-storage/upload-client'
import { Store as StoreCapabilities, Upload as UploadCapabilities } from '@web3-storage/capabilities'
import { Base } from './base.js'
import { Store } from './store.js'
import * as Signer from './signer.js'
import { Space } from './space.js'
import { Delegation } from './delegation.js'
import { StoreClient } from './capability/store.js'
import { UploadClient } from './capability/upload.js'
import { SpaceClient } from './capability/space.js'

export class Client extends Base {
  /**
   * @param {import('@web3-storage/access').AgentData} agentData
   * @param {object} [options]
   * @param {import('./service.js').ServiceConf} [options.serviceConf]
   */
  constructor (agentData, options) {
    super(agentData, options)
    this.capability = {
      store: new StoreClient(agentData, options),
      upload: new UploadClient(agentData, options),
      space: new SpaceClient(agentData, options)
    }
  }

  /**
   * Uploads a file to the service and returns the root data CID for the
   * generated DAG.
   *
   * @param {import('@web3-storage/upload-client/types').BlobLike} file File data.
   * @param {import('@web3-storage/upload-client/types').UploadOptions} [options]
   */
  async uploadFile(file, options = {}) {
    const conf = await this._invocationConfig([StoreCapabilities.add.can, UploadCapabilities.add.can])
    options.connection = this._serviceConf.upload
    return uploadFile(conf, file, options)
  }

  /**
   * Uploads a directory of files to the service and returns the root data CID
   * for the generated DAG. All files are added to a container directory, with
   * paths in file names preserved.
   *
   * @param {import('@web3-storage/upload-client/types').FileLike[]} files File data.
   * @param {import('@web3-storage/upload-client/types').UploadOptions} [options]
   */
  async uploadDirectory(files, options = {}) {
    const conf = await this._invocationConfig([StoreCapabilities.add.can, UploadCapabilities.add.can])
    options.connection = this._serviceConf.upload
    return uploadDirectory(conf, files, options)
  }

  /**
   * The current user agent (this device).
   */
  agent () {
    return this._agent.issuer
  }

  /**
   * The current space.
   */
  currentSpace () {
    const did = this._agent.currentSpace()
    return did ? new Space(did, this._agent.spaces.get(did)) : undefined
  }

  /**
   * Use a specific space.
   *
   * @param {import('@ucanto/interface').DID} did
   */
  async setCurrentSpace (did) {
    await this._agent.setCurrentSpace(did)
  }

  /**
   * Spaces available to this agent.
   */
  spaces () {
    return [...this._agent.spaces].map(([did, meta]) => new Space(did, meta))
  }

  /**
   * Create a new space with an optional name.
   *
   * @param {string} [name]
   */
  async createSpace (name) {
    await this._agent.createSpace(name)
  }

  /**
   * Register the _current_ space with the service.
   *
   * Invokes `voucher/redeem` for the free tier, waits on the websocket for the
   * `voucher/claim` and invokes it.
   *
   * It also adds a full space delegation to the service in the `voucher/claim`
   * invocation to allow for recovery.
   *
   * @param {string} email
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   */
  async registerSpace (email, options) {
    await this._agent.registerSpace(email, options)
  }

  /**
   * Add a space from a received proof.
   *
   * @param {import('@ucanto/interface').Delegation} proof
   */
   async addSpace (proof) {
    return await this._agent.importSpaceFromDelegation(proof)
  }

  /**
   * Get all the proofs matching the capabilities.
   *
   * Proofs are delegations with an _audience_ matching the agent DID.
   *
   * @param {import('@ucanto/interface').Capability[]} [caps] Capabilities to
   * filter by. Empty or undefined caps with return all the proofs.
   */
  async proofs (caps) {
    return await this._agent.proofs(caps)
  }

  /**
   * Add a proof to the agent. Proofs are delegations with an _audience_
   * matching the agent DID.
   *
   * @param {import('@ucanto/interface').Delegation} proof
   */
  async addProof (proof) {
    return await this._agent.addProof(proof)
  }

  /**
   * Get delegations created by the agent for others.
   *
   * @param {import('@ucanto/interface').Capability[]} [caps] Capabilities to
   * filter by. Empty or undefined caps with return all the delegations.
   */
  async delegations (caps) {
    /** @type {import('./delegation').Delegation<import('@ucanto/interface').Capabilities>[]} */
    const delegations = []
    for await (const { delegation, meta } of this._agent.delegationsWithMeta(caps)) {
      delegations.push(new Delegation(delegation.root, delegation.blocks, meta))
    }
    return delegations
  }

  /**
   * Create a delegation to the passed audience for the given abilities with
   * the _current_ space as the resource.
   * 
   * @param {import('@ucanto/interface').Principal} audience
   * @param {import('@web3-storage/capabilities/types').Abilities[]} abilities
   * @param {Omit<import('@ucanto/interface').UCANOptions, 'audience'> & { audienceMeta?: import('@web3-storage/access/types').AgentMeta }} [options]
   */
  async createDelegation (audience, abilities, options = {}) {
    const audienceMeta = options.audienceMeta ?? { name: '', type: 'device' }
    const d = await this._agent.delegate({
      ...options,
      abilities,
      audience,
      audienceMeta
    })
    return new Delegation(d.root, d.blocks, { audience: audienceMeta })
  }

  /**
   * Create a new upload client.
   *
   * If no backing store is passed one will be created that is appropriate for
   * the environment.
   *
   * If the backing store is empty, a new signing key will be generated and
   * persisted to the store. In the browser an unextractable RSA key will be
   * generated by default. In other environments an Ed25519 key is generated.
   *
   * If the backing store already has data stored, it will be loaded and used.
   *
   * @param {object} [options]
   * @param {import('@web3-storage/access/drivers/types').Driver<import('@web3-storage/access/types').AgentDataExport>} [options.store]
   * @param {import('./service.js').ServiceConf} [options.serviceConf]
   */
  static async create (options = {}) {
    const store = options.store ?? new Store()
    const raw = await store.load()
    if (raw) return new Client(AgentData.fromExport(raw, { store }), options)
    const principal = await Signer.generate()
    const data = await AgentData.create({ principal }, { store })
    return new Client(data, options)
  }
}
