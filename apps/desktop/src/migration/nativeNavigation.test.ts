// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {bindNativeNavigation} from './nativeNavigation';

it('retains fly movement during a delayed native acknowledgement',async()=>{
  let tick:FrameRequestCallback=()=>{};
  vi.stubGlobal('requestAnimationFrame',vi.fn((fn:FrameRequestCallback)=>{tick=fn;return 1;}));
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.spyOn(performance,'now').mockReturnValue(0);
  const node=document.createElement('div');node.setPointerCapture=vi.fn();node.hasPointerCapture=()=>false;
  const calls:Record<string,unknown>[]=[];let acknowledge=()=>{};
  const send=vi.fn((input:Record<string,unknown>)=>{calls.push(input);return new Promise<void>(resolve=>{acknowledge=resolve;});});
  const dispose=bindNativeNavigation(node,send,()=>{});
  try{
    const event=new MouseEvent('pointerdown',{button:2});Object.defineProperty(event,'pointerId',{value:1});node.dispatchEvent(event);
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}));
    tick(16);tick(32);tick(48);tick(64);
    expect(calls).toHaveLength(1);expect(calls[0].forward).toBeCloseTo(28.8);
    acknowledge();await new Promise(resolve=>setTimeout(resolve,0));tick(80);
    expect(calls).toHaveLength(2);expect(calls[1].forward).toBeCloseTo(115.2);
    window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}));
    acknowledge();await new Promise(resolve=>setTimeout(resolve,0));tick(96);expect(calls).toHaveLength(2);
  }finally{dispose();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
