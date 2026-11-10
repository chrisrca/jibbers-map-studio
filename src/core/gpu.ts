// The graphics card for work done on it ( a formation's erosion ): the view's own WebGPU device, once it has one.

let device: GPUDevice | null = null;

export const setComputeDevice = ( d: GPUDevice | null ) => {
  device = d;
};

export const computeDevice = () => device;
