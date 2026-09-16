import {SparklesIcon} from '@sanity/icons/Sparkles'
import {defineField, defineType} from 'sanity'

/**
 * Plan 026 spike fixture: the proposal document `altTextProposals` (the
 * scheduled Function) writes one of per missing-alt-text image, and
 * `proposalsSpike.tsx` (the `InboxSource`) reads back. Deliberately its own
 * document type, not a patch to the target `post` in place — see
 * `plans/mellow-weaving-cascade.md`'s "Findings — plan 026", Question 1:
 * this is what lets `agent.action.transform`'s image-description operation
 * write a proposed value *before* any human has reviewed it, without ever
 * touching the real document a proposal is about.
 */
export const imageAltProposal = defineType({
  name: 'structureInbox.imageAltProposal',
  title: 'Image alt-text proposal (spike)',
  type: 'document',
  icon: SparklesIcon,
  fields: [
    defineField({name: 'targetId', type: 'string', title: 'Target document id'}),
    defineField({name: 'targetTitle', type: 'string', title: 'Target document title'}),
    defineField({name: 'fieldPath', type: 'string', title: 'Field path on the target'}),
    // A copy of the target's image, not a reference to the target document's
    // own field — `agent.action.transform`'s image-description operation
    // needs an image value it can read directly on *this* document.
    defineField({name: 'sourceImage', type: 'image', title: 'Source image (copy)'}),
    defineField({name: 'proposedAlt', type: 'string', title: 'Proposed alt text'}),
    defineField({name: 'reason', type: 'string', title: 'Reason'}),
    defineField({name: 'targetChangedAt', type: 'datetime', title: 'Target changed at, when proposed'}),
  ],
  preview: {
    select: {title: 'proposedAlt', subtitle: 'targetTitle', media: 'sourceImage'},
  },
})
