//! Deterministic, UI-independent rules helpers for DnDRom.

use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvantageState {
    Normal,
    Advantage,
    Disadvantage,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckRequest {
    pub label: String,
    pub ability_score: i16,
    pub proficiency_bonus: i16,
    pub proficient: bool,
    pub difficulty_class: i16,
    pub advantage: AdvantageState,
    #[serde(default)]
    pub exhaustion_level: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RollResult {
    pub id: Uuid,
    pub label: String,
    pub rolls: Vec<i16>,
    pub kept: i16,
    pub modifier: i16,
    pub total: i16,
    pub difficulty_class: i16,
    pub success: bool,
    pub natural_one: bool,
    pub natural_twenty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePool {
    pub current: i32,
    pub maximum: i32,
    pub temporary: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DamageType {
    Acid,
    Bludgeoning,
    Cold,
    Fire,
    Force,
    Lightning,
    Necrotic,
    Piercing,
    Poison,
    Psychic,
    Radiant,
    Slashing,
    Thunder,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DamageProfile {
    pub resistances: Vec<DamageType>,
    pub vulnerabilities: Vec<DamageType>,
    pub immunities: Vec<DamageType>,
    pub flat_adjustment: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DamageResolution {
    pub rolled: i32,
    pub adjusted: i32,
    pub after_resistance: i32,
    pub final_damage: i32,
    pub immune: bool,
    pub resisted: bool,
    pub vulnerable: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RuleError {
    #[error("ability scores must be between 1 and 30")]
    InvalidAbilityScore,
    #[error("difficulty class must be between 1 and 40")]
    InvalidDifficultyClass,
    #[error("resource maximum cannot be negative")]
    InvalidResourceMaximum,
}

pub fn ability_modifier(score: i16) -> Result<i16, RuleError> {
    if !(1..=30).contains(&score) {
        return Err(RuleError::InvalidAbilityScore);
    }
    Ok((score - 10).div_euclid(2))
}

pub fn proficiency_bonus(level_or_cr: u8) -> i16 {
    (2 + (level_or_cr.saturating_sub(1) / 4) as i16).clamp(2, 9)
}

pub fn concentration_dc(damage_taken: i32) -> i16 {
    (damage_taken.max(0) / 2).clamp(10, 30) as i16
}

pub fn perform_check(request: &CheckRequest) -> Result<RollResult, RuleError> {
    if !(1..=40).contains(&request.difficulty_class) {
        return Err(RuleError::InvalidDifficultyClass);
    }
    let modifier = ability_modifier(request.ability_score)?
        + if request.proficient {
            request.proficiency_bonus
        } else {
            0
        };

    let mut rng = rand::rng();
    let first = rng.random_range(1..=20);
    let rolls = match request.advantage {
        AdvantageState::Normal => vec![first],
        AdvantageState::Advantage | AdvantageState::Disadvantage => {
            vec![first, rng.random_range(1..=20)]
        }
    };
    let kept = match request.advantage {
        AdvantageState::Normal => rolls[0],
        AdvantageState::Advantage => *rolls.iter().max().expect("two rolls"),
        AdvantageState::Disadvantage => *rolls.iter().min().expect("two rolls"),
    };
    let total = kept + modifier - i16::from(request.exhaustion_level.min(5)) * 2;

    Ok(RollResult {
        id: Uuid::new_v4(),
        label: request.label.clone(),
        rolls,
        kept,
        modifier,
        total,
        difficulty_class: request.difficulty_class,
        success: total >= request.difficulty_class,
        natural_one: kept == 1,
        natural_twenty: kept == 20,
    })
}

pub fn resolve_typed_damage(
    amount: i32,
    damage_type: DamageType,
    profile: &DamageProfile,
) -> DamageResolution {
    let rolled = amount.max(0);
    if profile.immunities.contains(&damage_type) {
        return DamageResolution {
            rolled,
            adjusted: rolled,
            after_resistance: 0,
            final_damage: 0,
            immune: true,
            resisted: false,
            vulnerable: false,
        };
    }
    let adjusted = (rolled + profile.flat_adjustment).max(0);
    let resisted = profile.resistances.contains(&damage_type);
    let vulnerable = profile.vulnerabilities.contains(&damage_type);
    let after_resistance = if resisted { adjusted / 2 } else { adjusted };
    DamageResolution {
        rolled,
        adjusted,
        after_resistance,
        final_damage: if vulnerable {
            after_resistance * 2
        } else {
            after_resistance
        },
        immune: false,
        resisted,
        vulnerable,
    }
}

pub fn apply_damage(pool: &ResourcePool, amount: i32) -> Result<ResourcePool, RuleError> {
    if pool.maximum < 0 {
        return Err(RuleError::InvalidResourceMaximum);
    }
    let mut next = pool.clone();
    let mut remaining = amount.max(0);
    let absorbed = remaining.min(next.temporary.max(0));
    next.temporary -= absorbed;
    remaining -= absorbed;
    next.current = (next.current - remaining).clamp(0, next.maximum);
    Ok(next)
}

pub fn apply_healing(pool: &ResourcePool, amount: i32) -> Result<ResourcePool, RuleError> {
    if pool.maximum < 0 {
        return Err(RuleError::InvalidResourceMaximum);
    }
    let mut next = pool.clone();
    next.current = (next.current + amount.max(0)).clamp(0, next.maximum);
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ability_modifiers_round_down() {
        assert_eq!(ability_modifier(8), Ok(-1));
        assert_eq!(ability_modifier(9), Ok(-1));
        assert_eq!(ability_modifier(10), Ok(0));
        assert_eq!(ability_modifier(18), Ok(4));
    }

    #[test]
    fn temporary_hit_points_absorb_damage_first() {
        let pool = ResourcePool {
            current: 12,
            maximum: 20,
            temporary: 4,
        };
        assert_eq!(
            apply_damage(&pool, 7).unwrap(),
            ResourcePool {
                current: 9,
                maximum: 20,
                temporary: 0
            }
        );
    }

    #[test]
    fn healing_is_capped() {
        let pool = ResourcePool {
            current: 18,
            maximum: 20,
            temporary: 3,
        };
        assert_eq!(apply_healing(&pool, 9).unwrap().current, 20);
    }

    #[test]
    fn proficiency_and_concentration_follow_srd_progression() {
        assert_eq!(proficiency_bonus(1), 2);
        assert_eq!(proficiency_bonus(17), 6);
        assert_eq!(concentration_dc(21), 10);
        assert_eq!(concentration_dc(100), 30);
    }

    #[test]
    fn typed_damage_applies_adjustment_resistance_then_vulnerability() {
        let profile = DamageProfile {
            resistances: vec![DamageType::Fire],
            vulnerabilities: vec![DamageType::Fire],
            immunities: vec![],
            flat_adjustment: -5,
        };
        assert_eq!(
            resolve_typed_damage(28, DamageType::Fire, &profile).final_damage,
            22
        );
    }
}
