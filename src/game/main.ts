import { Boot } from './scenes/Boot';
import { GreedRunScene } from './scenes/GreedRunScene';
import { MachineScene } from './scenes/MachineScene';
import { TrapTunnelsScene } from './scenes/TrapTunnelsScene';
import { TransitionScene } from './scenes/TransitionScene';
import { AUTO, Game } from 'phaser';

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: 1024,
    height: 768,
    parent: 'game-container',
    backgroundColor: '#101018',
    scene: [
        Boot,
        MachineScene,
        GreedRunScene,
        TrapTunnelsScene,
        TransitionScene
    ]
};

const StartGame = (parent: string) => {

    return new Game({ ...config, parent });

}

export default StartGame;
