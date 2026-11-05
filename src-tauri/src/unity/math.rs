//! Unity's transform maths: quaternions ( x, y, z, w ), 4×4 matrices ( columns ), Euler angles as Unity gives them
//! ( degrees, 0..360, Z then X then Y ), lossyScale.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat(pub f32, pub f32, pub f32, pub f32);

impl Quat {
    pub const IDENTITY: Quat = Quat(0.0, 0.0, 0.0, 1.0);

    pub fn mul(self, b: Quat) -> Quat {
        let Quat(ax, ay, az, aw) = self;
        let Quat(bx, by, bz, bw) = b;
        Quat(
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        )
    }

    pub fn normalized(self) -> Quat {
        let n = (self.0 * self.0 + self.1 * self.1 + self.2 * self.2 + self.3 * self.3).sqrt();
        if n < 1e-12 { Quat::IDENTITY } else { Quat(self.0 / n, self.1 / n, self.2 / n, self.3 / n) }
    }

    /// Quaternion.Euler: z about Z, then x about X, then y about Y ( degrees ).
    pub fn euler(x: f32, y: f32, z: f32) -> Quat {
        let h = |a: f32| (a.to_radians() * 0.5).sin_cos();
        let (sx, cx) = h(x);
        let (sy, cy) = h(y);
        let (sz, cz) = h(z);
        Quat(0.0, sy, 0.0, cy).mul(Quat(sx, 0.0, 0.0, cx)).mul(Quat(0.0, 0.0, sz, cz))
    }

    /// The rotation's 3×3 matrix, rows.
    pub fn matrix(self) -> [[f32; 3]; 3] {
        let Quat(x, y, z, w) = self.normalized();
        [
            [1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - z * w), 2.0 * (x * z + y * w)],
            [2.0 * (x * y + z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - x * w)],
            [2.0 * (x * z - y * w), 2.0 * (y * z + x * w), 1.0 - 2.0 * (x * x + y * y)],
        ]
    }

    /// Quaternion.eulerAngles: degrees, each 0..360.
    pub fn euler_angles(self) -> [f32; 3] {
        let m = self.matrix();
        let sx = (-m[1][2]).clamp(-1.0, 1.0);
        let x = sx.asin();
        let (y, z) = if sx.abs() < 0.999_999 { (m[0][2].atan2(m[2][2]), m[1][0].atan2(m[1][1])) } else { ((-m[2][0]).atan2(m[0][0]), 0.0) };
        let wrap = |a: f32| {
            let d = a.to_degrees() % 360.0;
            let d = if d < 0.0 { d + 360.0 } else { d };
            if d >= 360.0 - 1e-4 { 0.0 } else { d }
        };
        [wrap(x), wrap(y), wrap(z)]
    }

    pub fn rotate(self, v: [f32; 3]) -> [f32; 3] {
        let m = self.matrix();
        [0, 1, 2].map(|r| m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2])
    }
}

/// A 4×4 affine matrix, by columns.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mat4(pub [[f32; 4]; 4]);

impl Mat4 {
    pub const IDENTITY: Mat4 = Mat4([[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]);

    pub fn trs(t: [f32; 3], q: Quat, s: [f32; 3]) -> Mat4 {
        let r = q.matrix();
        let mut m = Mat4::IDENTITY;
        for c in 0..3 {
            for row in 0..3 {
                m.0[c][row] = r[row][c] * s[c];
            }
        }
        m.0[3] = [t[0], t[1], t[2], 1.0];
        m
    }

    pub fn mul(&self, b: &Mat4) -> Mat4 {
        let mut o = [[0.0f32; 4]; 4];
        for c in 0..4 {
            for r in 0..4 {
                o[c][r] = (0..4).map(|k| self.0[k][r] * b.0[c][k]).sum();
            }
        }
        Mat4(o)
    }

    pub fn point(&self, p: [f32; 3]) -> [f32; 3] {
        [0, 1, 2].map(|r| self.0[0][r] * p[0] + self.0[1][r] * p[1] + self.0[2][r] * p[2] + self.0[3][r])
    }

    pub fn position(&self) -> [f32; 3] {
        [self.0[3][0], self.0[3][1], self.0[3][2]]
    }

    /// The inverse of an affine matrix.
    pub fn inverse(&self) -> Mat4 {
        let a = |r: usize, c: usize| self.0[c][r];
        let det = a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
        if det.abs() < 1e-20 {
            return Mat4::IDENTITY;
        }
        let i = 1.0 / det;
        let mut inv = [[0.0f32; 3]; 3];
        inv[0][0] = (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) * i;
        inv[0][1] = (a(0, 2) * a(2, 1) - a(0, 1) * a(2, 2)) * i;
        inv[0][2] = (a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1)) * i;
        inv[1][0] = (a(1, 2) * a(2, 0) - a(1, 0) * a(2, 2)) * i;
        inv[1][1] = (a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0)) * i;
        inv[1][2] = (a(0, 2) * a(1, 0) - a(0, 0) * a(1, 2)) * i;
        inv[2][0] = (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0)) * i;
        inv[2][1] = (a(0, 1) * a(2, 0) - a(0, 0) * a(2, 1)) * i;
        inv[2][2] = (a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0)) * i;
        let t = self.position();
        let mut m = Mat4::IDENTITY;
        for r in 0..3 {
            for c in 0..3 {
                m.0[c][r] = inv[r][c];
            }
            m.0[3][r] = -(inv[r][0] * t[0] + inv[r][1] * t[1] + inv[r][2] * t[2]);
        }
        m
    }

    /// Transform.lossyScale: the scale left of the matrix once its rotation `q` is taken out.
    pub fn lossy_scale(&self, q: Quat) -> [f32; 3] {
        let r = q.matrix();
        // ( Rᵀ · M, its diagonal )
        [0, 1, 2].map(|i| (0..3).map(|k| r[k][i] * self.0[i][k]).sum())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn euler_round_trips() {
        for &(x, y, z) in &[(30.0, 45.0, 60.0), (10.0, 200.0, 350.0), (0.0, 90.0, 0.0), (300.0, 10.0, 20.0)] {
            let e = Quat::euler(x, y, z).euler_angles();
            let back = Quat::euler(e[0], e[1], e[2]);
            let q = Quat::euler(x, y, z);
            let dot = (q.0 * back.0 + q.1 * back.1 + q.2 * back.2 + q.3 * back.3).abs();
            assert!(dot > 0.9999, "{x} {y} {z} -> {e:?}");
        }
        let e = Quat::euler(30.0, 45.0, 60.0).euler_angles();
        assert!((e[0] - 30.0).abs() < 1e-3 && (e[1] - 45.0).abs() < 1e-3 && (e[2] - 60.0).abs() < 1e-3, "{e:?}");
    }

    #[test]
    fn matrices_compose_and_invert() {
        let a = Mat4::trs([1.0, 2.0, 3.0], Quat::euler(10.0, 20.0, 30.0), [2.0, 3.0, 4.0]);
        let p = a.point([0.5, -1.0, 2.0]);
        let back = a.inverse().point(p);
        assert!((back[0] - 0.5).abs() < 1e-4 && (back[1] + 1.0).abs() < 1e-4 && (back[2] - 2.0).abs() < 1e-4);
        let s = a.lossy_scale(Quat::euler(10.0, 20.0, 30.0));
        assert!((s[0] - 2.0).abs() < 1e-4 && (s[1] - 3.0).abs() < 1e-4 && (s[2] - 4.0).abs() < 1e-4, "{s:?}");
    }
}
