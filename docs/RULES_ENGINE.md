# Rules Engine Baseline and Coverage

Rules baseline: **System Reference Document 5.2.1**  
License: **Creative Commons Attribution 4.0 International**  
Official source: https://www.dndbeyond.com/srd

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

## Product boundary

“All D&D rules” is not a legally or technically precise implementable set. Official books contain material that is not in the openly licensed SRD, and many rules require a human ruling about fictional positioning. DnDRom uses SRD 5.2.1 as its versioned rules contract. Non-SRD settings, named characters, monsters, subclasses, spells, and other protected content are not bundled.

The engine distinguishes three states:

- **Deterministic:** executable code owns the outcome.
- **Data-driven:** the general mechanic exists, but individual SRD entries must be encoded and tested.
- **DM ruling:** the AI can propose a test or interpretation, but cannot mutate canonical state without validation.

## Current deterministic mechanics

- Six abilities, modifiers, skills, saving throws, proficiency progression, expertise-compatible multipliers, and passive scores.
- D20 tests, advantage/disadvantage cancellation, exhaustion penalties, natural attack results, and configurable DCs.
- Attack rolls, half/three-quarters/total cover, critical damage dice, and generic weapon/spell attack modifiers.
- All thirteen SRD damage types; flat adjustments, immunity, resistance, vulnerability, and the specified order of operations.
- Hit points, healing caps, temporary HP absorption, falling unconscious, damage while at 0 HP, massive damage, death-save successes/failures, natural 1/20 behavior, stability, and death state.
- Concentration save DC calculation and the state hooks needed to end concentration on incapacitation/death.
- Standard action vocabulary, action/bonus-action/reaction economy metadata, movement costs, difficult terrain, climbing/swimming/crawling, carrying capacity, and size multipliers.
- SRD condition registry and machine-readable combat effects for all fifteen named conditions, plus exhaustion level tracking.
- Short and Long Rests, Hit Point Dice, HP restoration, exhaustion reduction, death-save reset, and feature/resource recharge policies.
- Story checks and attacks remain proposed by the DM but rolled and committed by deterministic code.

The executable source is [srdRules.ts](../apps/desktop/src/domain/srdRules.ts), with regression coverage in [srdRules.test.ts](../apps/desktop/src/domain/srdRules.test.ts).

## SRD content coverage

| SRD section | Status | Next implementation boundary |
| --- | --- | --- |
| Playing the Game | Core deterministic | Complete grid collision, hiding/vision, social attitude, travel clock, hazards |
| Character Creation | Partial data model | Advancement choices, multiclass prerequisites, complete origins and feat selection |
| Classes | Framework only | Encode and test each SRD class/subclass feature by level |
| Character Origins | Import/editor fields | Species/background traits and origin-feat automation |
| Feats | Not yet encoded | Typed prerequisites, grants, modifiers, triggers and uses |
| Equipment | Action/inventory fields | Complete weapon, armor, mastery, tool, cost, crafting and vehicle data |
| Spells | Slots/resources only | Licensed spell catalog, targeting, areas, saves, concentration, scaling and effect reducers |
| Rules Glossary | Core registry | Remaining hazards, senses, areas, attitudes, objects and travel procedures |
| Gameplay Toolbox | Not yet encoded | Encounter budgets, environmental effects, traps, fear/stress, poison and travel pace |
| Magic Items | Inventory only | Attunement, charges, rarity, crafting and each licensed item effect |
| Monsters and Animals | Tokens only | Licensed stat blocks, actions, reactions, recharge, legendary behavior and encounter AI |

This matrix is deliberately explicit: the application must not label a class, spell, monster, or item “automated” until its data and reducer tests exist.
