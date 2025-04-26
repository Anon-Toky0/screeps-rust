use crate::*;
use js_sys::{JsString, Reflect};
use screeps::{Creep, SharedCreepProperties};

#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub enum CreepRole {
    Harvester,
    Upgrader,
    Builder,
    Carrier,
}

#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct CreepMemory {
    role: CreepRole,
    tasking: bool,
}

impl std::fmt::Display for CreepRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CreepRole::Harvester => write!(f, "Harvester"),
            CreepRole::Upgrader => write!(f, "Upgrader"),
            CreepRole::Builder => write!(f, "Builder"),
            CreepRole::Carrier => write!(f, "Carrier"),
        }
    }
}

pub fn work(creep: &Creep) {
    if let Ok(temp_memory) = Reflect::get(&screeps::memory::ROOT, &JsString::from(creep.name())) {
        let creep_memory: CreepMemory = serde_wasm_bindgen::from_value(temp_memory).unwrap();
        match creep_memory.role {
            CreepRole::Harvester => {}
            CreepRole::Upgrader => {}
            CreepRole::Builder => {}
            CreepRole::Carrier => {}
        }
    } else {
        log(format!("{} not found in memory", creep.name()).as_str());
    }
}
