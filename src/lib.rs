use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use screeps::{find, game, objects::*, prelude::*};

#[wasm_bindgen]
extern "C" {
    fn log(s: &str);
}

pub mod main_loop;

pub mod utils {
    pub mod role;
    pub mod spawn;
}

// 这是主函数
#[wasm_bindgen(js_name = loop)]
pub fn game_loop() {
    for room in game::rooms().values() {
        room.find(find::MY_CREEPS, Option::None)
            .iter()
            .for_each(|creep| {});
    }
}
