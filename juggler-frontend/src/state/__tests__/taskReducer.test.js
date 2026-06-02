/**
 * Tests for taskReducer — focuses on TEMPLATE_PROPS propagation (CR-JUG-W5).
 * rigid must NOT propagate to sibling recurring instances when one instance is edited.
 */
import taskReducer, { TASK_STATE_INIT } from '../taskReducer';

describe('taskReducer — TEMPLATE_PROPS propagation (CR-JUG-W5)', () => {
  const sourceTask = {
    id: 'source-1',
    text: 'Weekly review',
    dur: 60,
    pri: 2,
    rigid: true,   // set on the source
    timeFlex: false,
    sourceId: null,
  };
  const instance1 = {
    id: 'inst-1',
    text: 'Weekly review',
    dur: 60,
    pri: 2,
    rigid: false,  // instance may differ
    timeFlex: false,
    sourceId: 'source-1',
  };
  const instance2 = {
    id: 'inst-2',
    text: 'Weekly review',
    dur: 60,
    pri: 2,
    rigid: false,
    timeFlex: false,
    sourceId: 'source-1',
  };

  const initState = {
    ...TASK_STATE_INIT,
    tasks: [sourceTask, instance1, instance2],
  };

  it('does NOT propagate rigid to sibling instances when updating an instance', () => {
    const action = {
      type: 'UPDATE_TASK',
      id: 'inst-1',
      fields: { rigid: true, text: 'Weekly review (updated)' },
    };
    const nextState = taskReducer(initState, action);

    // inst-1 should be updated
    const updatedInst1 = nextState.tasks.find(t => t.id === 'inst-1');
    expect(updatedInst1.rigid).toBe(true);
    expect(updatedInst1.text).toBe('Weekly review (updated)');

    // inst-2 should NOT have rigid propagated (rigid is not in TEMPLATE_PROPS)
    const updatedInst2 = nextState.tasks.find(t => t.id === 'inst-2');
    expect(updatedInst2.rigid).toBe(false);

    // source task should NOT have rigid propagated either
    const updatedSource = nextState.tasks.find(t => t.id === 'source-1');
    expect(updatedSource.rigid).toBe(true); // source keeps its own rigid value
  });

  it('DOES propagate text (a TEMPLATE_PROP) to sibling instances', () => {
    const action = {
      type: 'UPDATE_TASK',
      id: 'inst-1',
      fields: { text: 'New title' },
    };
    const nextState = taskReducer(initState, action);

    const updatedInst2 = nextState.tasks.find(t => t.id === 'inst-2');
    expect(updatedInst2.text).toBe('New title');
  });

  it('DOES propagate dur (a TEMPLATE_PROP) to sibling instances', () => {
    const action = {
      type: 'UPDATE_TASK',
      id: 'inst-1',
      fields: { dur: 90 },
    };
    const nextState = taskReducer(initState, action);

    const updatedInst2 = nextState.tasks.find(t => t.id === 'inst-2');
    expect(updatedInst2.dur).toBe(90);
  });
});
