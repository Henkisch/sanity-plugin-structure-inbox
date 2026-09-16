import {defineBlueprint, defineRobotToken, defineScheduledFunction} from '@sanity/blueprints'

/**
 * Plan 026 spike: a real, deployed, scheduled Function — see
 * `plans/mellow-weaving-cascade.md`'s "Findings — plan 026" for what this
 * proved. `editorRobot` grants `altTextProposals` write access to the same
 * dataset the Studio itself reads, the only way a scheduled Function (no
 * triggering document, so no `clientOptions.token` for free) gets one.
 */
export default defineBlueprint({
  resources: [
    defineRobotToken({
      name: 'altTextProposalsRobot',
      memberships: [
        {
          resourceType: 'project',
          resourceId: process.env.SANITY_STUDIO_PROJECT_ID,
          roleNames: ['editor'],
        },
      ],
    }),
    defineScheduledFunction({
      name: 'altTextProposals',
      event: {expression: '0 0 * * *'},
      robotToken: '${resources.altTextProposalsRobot.token}',
    }),
  ],
})
