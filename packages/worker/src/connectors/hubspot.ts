import type { Env, Integration, IndexedItem } from '../types'

interface HubSpotContact {
  id: string
  properties: {
    email?: string
    firstname?: string
    lastname?: string
    company?: string
    phone?: string
    lifecyclestage?: string
    hs_lead_status?: string
    createdate?: string
    lastmodifieddate?: string
    notes_last_updated?: string
  }
}

interface HubSpotDeal {
  id: string
  properties: {
    dealname?: string
    amount?: string
    dealstage?: string
    pipeline?: string
    closedate?: string
    createdate?: string
    hs_lastmodifieddate?: string
    description?: string
    hubspot_owner_id?: string
  }
  associations?: {
    contacts?: { results: Array<{ id: string }> }
    companies?: { results: Array<{ id: string }> }
  }
}

interface HubSpotCompany {
  id: string
  properties: {
    name?: string
    domain?: string
    industry?: string
    phone?: string
    city?: string
    state?: string
    country?: string
    description?: string
    createdate?: string
    hs_lastmodifieddate?: string
  }
}

interface HubSpotNote {
  id: string
  properties: {
    hs_note_body?: string
    hs_createdate?: string
    hs_lastmodifieddate?: string
    hubspot_owner_id?: string
  }
  associations?: {
    contacts?: { results: Array<{ id: string }> }
    deals?: { results: Array<{ id: string }> }
    companies?: { results: Array<{ id: string }> }
  }
}

export class HubSpotConnector {
  private env: Env
  private integration: Integration
  private accessToken: string

  constructor(env: Env, integration: Integration, accessToken: string) {
    this.env = env
    this.integration = integration
    this.accessToken = accessToken
  }

  private async hubspotFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`https://api.hubapi.com${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`HubSpot API error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  async syncAll(): Promise<number> {
    let totalIndexed = 0

    // Update status to syncing
    await this.env.DB.prepare(`
      UPDATE integrations SET status = 'syncing', updated_at = datetime('now') WHERE id = ?
    `).bind(this.integration.id).run()

    try {
      // Sync contacts
      totalIndexed += await this.syncContacts()

      // Sync deals
      totalIndexed += await this.syncDeals()

      // Sync companies
      totalIndexed += await this.syncCompanies()

      // Sync notes/engagements
      totalIndexed += await this.syncNotes()

      // Update integration status
      await this.env.DB.prepare(`
        UPDATE integrations
        SET status = 'active',
            last_sync_at = datetime('now'),
            items_indexed = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(totalIndexed, this.integration.id).run()

      return totalIndexed
    } catch (err) {
      console.error('HubSpot sync error:', err)
      await this.env.DB.prepare(`
        UPDATE integrations SET status = 'error', updated_at = datetime('now') WHERE id = ?
      `).bind(this.integration.id).run()
      throw err
    }
  }

  private async syncContacts(): Promise<number> {
    let indexed = 0
    let after: string | undefined

    do {
      const params = new URLSearchParams({
        limit: '100',
        properties: 'email,firstname,lastname,company,phone,lifecyclestage,hs_lead_status,createdate,lastmodifieddate',
      })
      if (after) params.set('after', after)

      const response = await this.hubspotFetch<{
        results: HubSpotContact[]
        paging?: { next?: { after: string } }
      }>(`/crm/v3/objects/contacts?${params}`)

      for (const contact of response.results) {
        await this.indexContact(contact)
        indexed++
      }

      after = response.paging?.next?.after
    } while (after && indexed < 500) // Limit to 500 contacts per sync

    console.log(`Indexed ${indexed} HubSpot contacts`)
    return indexed
  }

  private async indexContact(contact: HubSpotContact): Promise<void> {
    const props = contact.properties
    const name = [props.firstname, props.lastname].filter(Boolean).join(' ') || 'Unknown'

    const content = [
      `Contact: ${name}`,
      props.email && `Email: ${props.email}`,
      props.company && `Company: ${props.company}`,
      props.phone && `Phone: ${props.phone}`,
      props.lifecyclestage && `Lifecycle Stage: ${props.lifecyclestage}`,
      props.hs_lead_status && `Lead Status: ${props.hs_lead_status}`,
    ].filter(Boolean).join('\n')

    const itemId = `hubspot_contact_${contact.id}`

    await this.env.DB.prepare(`
      INSERT INTO indexed_items (
        id, workspace_id, integration_id, source, source_id, source_url,
        title, content, content_type, author_name, author_email,
        created_at, updated_at, indexed_at
      ) VALUES (?, ?, ?, 'hubspot', ?, ?, ?, ?, 'contact', ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(workspace_id, source, source_id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        author_email = excluded.author_email,
        updated_at = excluded.updated_at,
        indexed_at = datetime('now')
    `).bind(
      itemId,
      this.integration.workspace_id,
      this.integration.id,
      contact.id,
      `https://app.hubspot.com/contacts/${contact.id}`,
      name,
      content,
      name,
      props.email || null,
      props.createdate || new Date().toISOString(),
      props.lastmodifieddate || null
    ).run()
  }

  private async syncDeals(): Promise<number> {
    let indexed = 0
    let after: string | undefined

    do {
      const params = new URLSearchParams({
        limit: '100',
        properties: 'dealname,amount,dealstage,pipeline,closedate,createdate,hs_lastmodifieddate,description',
        associations: 'contacts,companies',
      })
      if (after) params.set('after', after)

      const response = await this.hubspotFetch<{
        results: HubSpotDeal[]
        paging?: { next?: { after: string } }
      }>(`/crm/v3/objects/deals?${params}`)

      for (const deal of response.results) {
        await this.indexDeal(deal)
        indexed++
      }

      after = response.paging?.next?.after
    } while (after && indexed < 500)

    console.log(`Indexed ${indexed} HubSpot deals`)
    return indexed
  }

  private async indexDeal(deal: HubSpotDeal): Promise<void> {
    const props = deal.properties
    const name = props.dealname || 'Untitled Deal'

    const content = [
      `Deal: ${name}`,
      props.amount && `Amount: $${parseFloat(props.amount).toLocaleString()}`,
      props.dealstage && `Stage: ${props.dealstage}`,
      props.pipeline && `Pipeline: ${props.pipeline}`,
      props.closedate && `Close Date: ${new Date(props.closedate).toLocaleDateString()}`,
      props.description && `Description: ${props.description}`,
    ].filter(Boolean).join('\n')

    const itemId = `hubspot_deal_${deal.id}`

    await this.env.DB.prepare(`
      INSERT INTO indexed_items (
        id, workspace_id, integration_id, source, source_id, source_url,
        title, content, content_type,
        created_at, updated_at, indexed_at
      ) VALUES (?, ?, ?, 'hubspot', ?, ?, ?, ?, 'deal', ?, ?, datetime('now'))
      ON CONFLICT(workspace_id, source, source_id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        updated_at = excluded.updated_at,
        indexed_at = datetime('now')
    `).bind(
      itemId,
      this.integration.workspace_id,
      this.integration.id,
      deal.id,
      `https://app.hubspot.com/deals/${deal.id}`,
      name,
      content,
      props.createdate || new Date().toISOString(),
      props.hs_lastmodifieddate || null
    ).run()
  }

  private async syncCompanies(): Promise<number> {
    let indexed = 0
    let after: string | undefined

    do {
      const params = new URLSearchParams({
        limit: '100',
        properties: 'name,domain,industry,phone,city,state,country,description,createdate,hs_lastmodifieddate',
      })
      if (after) params.set('after', after)

      const response = await this.hubspotFetch<{
        results: HubSpotCompany[]
        paging?: { next?: { after: string } }
      }>(`/crm/v3/objects/companies?${params}`)

      for (const company of response.results) {
        await this.indexCompany(company)
        indexed++
      }

      after = response.paging?.next?.after
    } while (after && indexed < 500)

    console.log(`Indexed ${indexed} HubSpot companies`)
    return indexed
  }

  private async indexCompany(company: HubSpotCompany): Promise<void> {
    const props = company.properties
    const name = props.name || 'Unknown Company'

    const content = [
      `Company: ${name}`,
      props.domain && `Website: ${props.domain}`,
      props.industry && `Industry: ${props.industry}`,
      props.phone && `Phone: ${props.phone}`,
      [props.city, props.state, props.country].filter(Boolean).join(', '),
      props.description && `Description: ${props.description}`,
    ].filter(Boolean).join('\n')

    const itemId = `hubspot_company_${company.id}`

    await this.env.DB.prepare(`
      INSERT INTO indexed_items (
        id, workspace_id, integration_id, source, source_id, source_url,
        title, content, content_type,
        created_at, updated_at, indexed_at
      ) VALUES (?, ?, ?, 'hubspot', ?, ?, ?, ?, 'company', ?, ?, datetime('now'))
      ON CONFLICT(workspace_id, source, source_id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        updated_at = excluded.updated_at,
        indexed_at = datetime('now')
    `).bind(
      itemId,
      this.integration.workspace_id,
      this.integration.id,
      company.id,
      `https://app.hubspot.com/companies/${company.id}`,
      name,
      content,
      props.createdate || new Date().toISOString(),
      props.hs_lastmodifieddate || null
    ).run()
  }

  private async syncNotes(): Promise<number> {
    let indexed = 0
    let after: string | undefined

    do {
      const params = new URLSearchParams({
        limit: '100',
        properties: 'hs_note_body,hs_createdate,hs_lastmodifieddate',
        associations: 'contacts,deals,companies',
      })
      if (after) params.set('after', after)

      const response = await this.hubspotFetch<{
        results: HubSpotNote[]
        paging?: { next?: { after: string } }
      }>(`/crm/v3/objects/notes?${params}`)

      for (const note of response.results) {
        if (note.properties.hs_note_body) {
          await this.indexNote(note)
          indexed++
        }
      }

      after = response.paging?.next?.after
    } while (after && indexed < 500)

    console.log(`Indexed ${indexed} HubSpot notes`)
    return indexed
  }

  private async indexNote(note: HubSpotNote): Promise<void> {
    const props = note.properties
    const body = props.hs_note_body || ''
    const title = body.slice(0, 100) + (body.length > 100 ? '...' : '')

    const itemId = `hubspot_note_${note.id}`

    await this.env.DB.prepare(`
      INSERT INTO indexed_items (
        id, workspace_id, integration_id, source, source_id, source_url,
        title, content, content_type,
        created_at, updated_at, indexed_at
      ) VALUES (?, ?, ?, 'hubspot', ?, ?, ?, ?, 'comment', ?, ?, datetime('now'))
      ON CONFLICT(workspace_id, source, source_id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        updated_at = excluded.updated_at,
        indexed_at = datetime('now')
    `).bind(
      itemId,
      this.integration.workspace_id,
      this.integration.id,
      note.id,
      `https://app.hubspot.com/notes/${note.id}`,
      title,
      body,
      props.hs_createdate || new Date().toISOString(),
      props.hs_lastmodifieddate || null
    ).run()
  }
}
