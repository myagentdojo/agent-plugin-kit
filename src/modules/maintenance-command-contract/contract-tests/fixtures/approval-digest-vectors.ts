export type ApprovalDigestVector = {
  issuer:
    | "release-and-git-engine"
    | "harness-journeys:claude"
    | "harness-journeys:codex"
  candidateBytes: string
  candidateDigest: `sha256:${string}`
  inspectedStateBytes: string
  inspectedStateDigest: `sha256:${string}`
  expectedEffectsBytes: string
  expectedEffectsDigest: `sha256:${string}`
  approvalBytes: string
  approvalDigest: `sha256:${string}`
}

// Independent oracle: these literal bytes and digests were produced by a
// test-owned one-shot encoder, outside every production Interface and future
// Implementation. Tests may hash these bytes, but never derive expected bytes
// or digests from the encoder under test.
const candidateBytes =
  "r38:agent-plugin-kit.candidate-identity.v11:922:sourceRepositoryOrigin53:s49:https://github.com/myagentdojo/example-plugin.git12:sourceCommit44:s40:111111111111111111111111111111111111111116:releaseReference20:s16:refs/tags/v1.0.013:releaseCommit44:s40:111111111111111111111111111111111111111123:packageRepositoryOrigin55:s51:https://github.com/myagentdojo/agent-plugin-kit.git13:packageCommit44:s40:111111111111111111111111111111111111111124:workflowRepositoryOrigin55:s51:https://github.com/myagentdojo/agent-plugin-kit.git12:workflowPath44:s40:.github/workflows/plugin-maintenance.yml14:workflowCommit44:s40:1111111111111111111111111111111111111111"
const candidateDigest =
  "sha256:2af031b2b3bc51ced417b607dd3e1d937b01534e37d831c392bf85022e903566"

export const approvalDigestVectors: readonly ApprovalDigestVector[] = [
  {
    issuer: "release-and-git-engine",
    candidateBytes,
    candidateDigest,
    inspectedStateBytes:
      "r41:release-and-git-engine.inspected-state.v11:86:intent15:s11:maintenance14:topologySha25675:s71:sha256:222222222222222222222222222222222222222222222222222222222222222216:projectionSha25675:s71:sha256:333333333333333333333333333333333333333333333333333333333333333324:packageObservationSha25675:s71:sha256:444444444444444444444444444444444444444444444444444444444444444425:workflowObservationSha25675:s71:sha256:555555555555555555555555555555555555555555555555555555555555555512:releaseState8:s5:ready18:completedEffectIds4:l1:018:remainingEffectIds25:l1:118:s14:effect:release",
    inspectedStateDigest:
      "sha256:fe794bd2578428889170ddefe91bd2a6a5e0d3b6755944cd74ceb49d5162533e",
    expectedEffectsBytes:
      "r42:release-and-git-engine.expected-effects.v11:17:effects193:l1:1185:r46:release-and-git-engine.expected-effect-item.v11:28:effectId18:s14:effect:release20:targetIdentitySha25675:s71:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    expectedEffectsDigest:
      "sha256:1709dba6fed3c45dc70a4e0af8f7ffe3b1fb09ec580894b79c0d5a4b680af348",
    approvalBytes:
      "r38:agent-plugin-kit.candidate-approval.v11:46:issuer26:s22:release-and-git-engine23:candidateIdentitySha25675:s71:sha256:2af031b2b3bc51ced417b607dd3e1d937b01534e37d831c392bf85022e90356620:inspectedStateSha25675:s71:sha256:fe794bd2578428889170ddefe91bd2a6a5e0d3b6755944cd74ceb49d5162533e21:expectedEffectsSha25675:s71:sha256:1709dba6fed3c45dc70a4e0af8f7ffe3b1fb09ec580894b79c0d5a4b680af348",
    approvalDigest:
      "sha256:91fa24c36a2b1c705fa539bdafc160e303a539a8973ec5b48b28453fc5fd9f45",
  },
  {
    issuer: "harness-journeys:claude",
    candidateBytes,
    candidateDigest,
    inspectedStateBytes:
      "r42:harness-journeys:claude.inspected-state.v11:613:payloadSha25675:s71:sha256:666666666666666666666666666666666666666666666666666666666666666616:checkoutIdentity14:s10:checkout-a15:profileIdentity18:s14:claude-profile17:claudeStateSha25675:s71:sha256:777777777777777777777777777777777777777777777777777777777777777718:completedEffectIds4:l1:018:remainingEffectIds24:l1:117:s13:effect:claude",
    inspectedStateDigest:
      "sha256:397ec49639477d57894eea520280ac9691dc54dbbc5c8a45c54ab74c5efe96c7",
    expectedEffectsBytes:
      "r43:harness-journeys:claude.expected-effects.v11:17:effects193:l1:1185:r47:harness-journeys:claude.expected-effect-item.v11:28:effectId17:s13:effect:claude20:targetIdentitySha25675:s71:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    expectedEffectsDigest:
      "sha256:ab481da5474cd171b88431b0bc95eb42ee3c16f077f9c331af33ce372cad415e",
    approvalBytes:
      "r38:agent-plugin-kit.candidate-approval.v11:46:issuer27:s23:harness-journeys:claude23:candidateIdentitySha25675:s71:sha256:2af031b2b3bc51ced417b607dd3e1d937b01534e37d831c392bf85022e90356620:inspectedStateSha25675:s71:sha256:397ec49639477d57894eea520280ac9691dc54dbbc5c8a45c54ab74c5efe96c721:expectedEffectsSha25675:s71:sha256:ab481da5474cd171b88431b0bc95eb42ee3c16f077f9c331af33ce372cad415e",
    approvalDigest:
      "sha256:adaf2d0d8c1866d78479c03fc25677ed1a46017af0595c1dd9ab091aa257cb5c",
  },
  {
    issuer: "harness-journeys:codex",
    candidateBytes,
    candidateDigest,
    inspectedStateBytes:
      "r41:harness-journeys:codex.inspected-state.v11:613:payloadSha25675:s71:sha256:888888888888888888888888888888888888888888888888888888888888888816:checkoutIdentity14:s10:checkout-b15:profileIdentity17:s13:codex-profile16:codexStateSha25675:s71:sha256:999999999999999999999999999999999999999999999999999999999999999918:completedEffectIds4:l1:018:remainingEffectIds23:l1:116:s12:effect:codex",
    inspectedStateDigest:
      "sha256:4a01bec4110a5e1a8eb7b89d81a440e9cfb2d1bc53d5879355d7b40b8adea195",
    expectedEffectsBytes:
      "r42:harness-journeys:codex.expected-effects.v11:17:effects191:l1:1183:r46:harness-journeys:codex.expected-effect-item.v11:28:effectId16:s12:effect:codex20:targetIdentitySha25675:s71:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    expectedEffectsDigest:
      "sha256:70f7eee8841da88a3e731759ba6905b2ab5529d04474d2cab24ec33cce554e54",
    approvalBytes:
      "r38:agent-plugin-kit.candidate-approval.v11:46:issuer26:s22:harness-journeys:codex23:candidateIdentitySha25675:s71:sha256:2af031b2b3bc51ced417b607dd3e1d937b01534e37d831c392bf85022e90356620:inspectedStateSha25675:s71:sha256:4a01bec4110a5e1a8eb7b89d81a440e9cfb2d1bc53d5879355d7b40b8adea19521:expectedEffectsSha25675:s71:sha256:70f7eee8841da88a3e731759ba6905b2ab5529d04474d2cab24ec33cce554e54",
    approvalDigest:
      "sha256:335943b90fced29a2da6c4dfba4d8de1cf6ede4a7377d9c94d6a12bafbb4f620",
  },
]
