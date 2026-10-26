//! Quaternions and Unity's Euler angles, for pieces taken into their own frame.

// --- moving an object's world-space parts into its own frame (pivot at the origin)

pub(crate) type Quat = [f32; 4];

pub(crate) fn quat_mul(a: Quat, b: Quat) -> Quat {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

pub(crate) fn axis_angle(axis: usize, deg: f32) -> Quat {
    let h = deg.to_radians() / 2.0;
    let mut q = [0.0, 0.0, 0.0, h.cos()];
    q[axis] = h.sin();
    q
}

/// Unity applies Euler angles Z, then X, then Y.
pub(crate) fn quat_from_unity_euler(e: [f32; 3]) -> Quat {
    quat_mul(axis_angle(1, e[1]), quat_mul(axis_angle(0, e[0]), axis_angle(2, e[2])))
}

pub(crate) fn unity_euler_from_quat(q: Quat) -> [f32; 3] {
    let [x, y, z, w] = q;
    let sx = (2.0 * (w * x - y * z)).clamp(-1.0, 1.0);
    let ex = sx.asin();
    let (ey, ez) = if sx.abs() > 0.9999 {
        ((2.0 * (w * y - x * z)).atan2(1.0 - 2.0 * (y * y + z * z)), 0.0)
    } else {
        ((2.0 * (w * y + x * z)).atan2(1.0 - 2.0 * (x * x + y * y)), (2.0 * (w * z + x * y)).atan2(1.0 - 2.0 * (x * x + z * z)))
    };
    let deg = |r: f32| (r.to_degrees() + 360.0) % 360.0;
    [deg(ex), deg(ey), deg(ez)]
}

pub(crate) fn conj(q: Quat) -> Quat {
    [-q[0], -q[1], -q[2], q[3]]
}

pub(crate) fn rotate(q: Quat, v: [f32; 3]) -> [f32; 3] {
    let p = quat_mul(quat_mul(q, [v[0], v[1], v[2], 0.0]), conj(q));
    [p[0], p[1], p[2]]
}
