"""The small amount of 3D maths a model importer needs, in one place.

Both model sources the toolkit reads arrive as a tree of local transforms: DMX stores a
position and a quaternion per element, glTF stores either TRS or a 4x4 matrix per node.
`studiomdl` wants the SMD skeleton as a position plus three XYZ Euler angles per bone, so
every importer has to compose, invert and decompose the same kinds of matrix. Keeping one
implementation is what stops the two paths from drifting apart on a sign.

Conventions, and why they are these ones:

* Matrices are **row-major** here (``m[row][col]``). glTF writes column-major arrays, and
  `mat4_from_gltf` is the only place that transposes. A column vector is ``m[r][0..2]``.
* A quaternion is ``(x, y, z, w)``, as in glTF and DMX.
* The SMD Euler triple is the one BlenderSourceTools writes and `studiomdl` reads:
  roll/pitch/yaw about X/Y/Z, in radians. `dmxsmd` was verified against BlenderSourceTools'
  own cube export (quaternion ``(0.683, 0.183, 0.183, 0.683)`` -> ``(1.570796, 0, 0.523599)``);
  `euler_xyz` is that same function, moved here so glTF cannot pick a different order.
* ``gltf_to_source`` is glTF's +Y-up to Source's +Z-up: ``(x, y, z) -> (x, -z, y)``. It
  matches the compiler's published ``srcaxis y`` matrix (the reference implementation's glTF oracle),
  but no code from that project is copied: this is the algebra stated in its documentation.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

Vec3 = tuple[float, float, float]
Vec4 = tuple[float, float, float, float]
Mat4 = list[list[float]]


def mat4_identity() -> Mat4:
    return [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def mat4_from_gltf(values: Sequence[float]) -> Mat4:
    """A glTF 4x4 array (column-major) as a row-major matrix."""
    if len(values) != 16:
        raise ValueError(f"a 4x4 matrix needs 16 numbers, got {len(values)}")
    return [[float(values[col * 4 + row]) for col in range(4)] for row in range(4)]


def mat4_to_gltf(m: Mat4) -> list[float]:
    return [m[row][col] for col in range(4) for row in range(4)]


def mat4_mul(a: Mat4, b: Mat4) -> Mat4:
    out = [[0.0] * 4 for _ in range(4)]
    for row in range(4):
        for col in range(4):
            out[row][col] = (
                a[row][0] * b[0][col]
                + a[row][1] * b[1][col]
                + a[row][2] * b[2][col]
                + a[row][3] * b[3][col]
            )
    return out


def mat4_translation(x: float, y: float, z: float) -> Mat4:
    m = mat4_identity()
    m[0][3], m[1][3], m[2][3] = x, y, z
    return m


def mat4_scale(x: float, y: float, z: float) -> Mat4:
    m = mat4_identity()
    m[0][0], m[1][1], m[2][2] = x, y, z
    return m


def mat4_rotation(quat: Vec4) -> Mat4:
    x, y, z, w = quat_normalize(quat)
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    xw, yw, zw = x * w, y * w, z * w
    return [
        [1.0 - 2.0 * (yy + zz), 2.0 * (xy - zw), 2.0 * (xz + yw), 0.0],
        [2.0 * (xy + zw), 1.0 - 2.0 * (xx + zz), 2.0 * (yz - xw), 0.0],
        [2.0 * (xz - yw), 2.0 * (yz + xw), 1.0 - 2.0 * (xx + yy), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def mat4_from_trs(
    translation: Sequence[float],
    quat: Sequence[float],
    scale: Sequence[float],
) -> Mat4:
    t = mat4_translation(float(translation[0]), float(translation[1]), float(translation[2]))
    r = mat4_rotation((float(quat[0]), float(quat[1]), float(quat[2]), float(quat[3])))
    s = mat4_scale(float(scale[0]), float(scale[1]), float(scale[2]))
    return mat4_mul(t, mat4_mul(r, s))


def mat4_inverse(m: Mat4) -> Mat4 | None:
    """Gauss-Jordan inverse. ``None`` for a singular matrix (a zero node scale)."""
    work = [list(row) + [1.0 if row_index == col else 0.0 for col in range(4)] for row_index, row in enumerate(m)]
    for col in range(4):
        pivot = max(range(col, 4), key=lambda r: abs(work[r][col]))
        if abs(work[pivot][col]) < 1e-12:
            return None
        if pivot != col:
            work[col], work[pivot] = work[pivot], work[col]
        divisor = work[col][col]
        work[col] = [value / divisor for value in work[col]]
        for row in range(4):
            if row == col:
                continue
            factor = work[row][col]
            if factor == 0.0:
                continue
            work[row] = [work[row][i] - factor * work[col][i] for i in range(8)]
    return [row[4:] for row in work]


def mat4_transform_point(m: Mat4, point: Sequence[float]) -> Vec3:
    x, y, z = float(point[0]), float(point[1]), float(point[2])
    w = m[3][0] * x + m[3][1] * y + m[3][2] * z + m[3][3]
    if abs(w) > 1e-12 and abs(w - 1.0) > 1e-12:
        x, y, z = x / w, y / w, z / w
    return (
        m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
        m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
        m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
    )


def mat4_transform_direction(m: Mat4, vector: Sequence[float]) -> Vec3:
    x, y, z = float(vector[0]), float(vector[1]), float(vector[2])
    return (
        m[0][0] * x + m[0][1] * y + m[0][2] * z,
        m[1][0] * x + m[1][1] * y + m[1][2] * z,
        m[2][0] * x + m[2][1] * y + m[2][2] * z,
    )


def mat3_normal(m: Mat4) -> list[list[float]]:
    """Inverse-transpose of the upper 3x3, for a normal under a non-uniform scale."""
    a = [[m[r][c] for c in range(3)] for r in range(3)]
    det = (
        a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
        - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
        + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
    )
    if abs(det) < 1e-12:
        return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    inv_det = 1.0 / det
    inverse = [
        [
            (a[1][1] * a[2][2] - a[1][2] * a[2][1]) * inv_det,
            (a[0][2] * a[2][1] - a[0][1] * a[2][2]) * inv_det,
            (a[0][1] * a[1][2] - a[0][2] * a[1][1]) * inv_det,
        ],
        [
            (a[1][2] * a[2][0] - a[1][0] * a[2][2]) * inv_det,
            (a[0][0] * a[2][2] - a[0][2] * a[2][0]) * inv_det,
            (a[0][2] * a[1][0] - a[0][0] * a[1][2]) * inv_det,
        ],
        [
            (a[1][0] * a[2][1] - a[1][1] * a[2][0]) * inv_det,
            (a[0][1] * a[2][0] - a[0][0] * a[2][1]) * inv_det,
            (a[0][0] * a[1][1] - a[0][1] * a[1][0]) * inv_det,
        ],
    ]
    # inverse-transpose
    return [[inverse[c][r] for c in range(3)] for r in range(3)]


def quat_normalize(quat: Sequence[float]) -> Vec4:
    x, y, z, w = (float(v) for v in quat)
    length = math.sqrt(x * x + y * y + z * z + w * w)
    if length < 1e-12:
        return (0.0, 0.0, 0.0, 1.0)
    return (x / length, y / length, z / length, w / length)


def quat_from_matrix(m: Mat4) -> Vec4:
    """Rotation part of a row-major matrix as a quaternion.

    Shepperd's method: pick the largest diagonal term so the square root never loses
    precision near 180 degrees.
    """
    r00, r01, r02 = m[0][0], m[0][1], m[0][2]
    r10, r11, r12 = m[1][0], m[1][1], m[1][2]
    r20, r21, r22 = m[2][0], m[2][1], m[2][2]
    trace = r00 + r11 + r22
    if trace > 0.0:
        s = math.sqrt(trace + 1.0) * 2.0
        w = 0.25 * s
        x = (r21 - r12) / s
        y = (r02 - r20) / s
        z = (r10 - r01) / s
    elif r00 > r11 and r00 > r22:
        s = math.sqrt(max(0.0, 1.0 + r00 - r11 - r22)) * 2.0
        w = (r21 - r12) / s
        x = 0.25 * s
        y = (r01 + r10) / s
        z = (r02 + r20) / s
    elif r11 > r22:
        s = math.sqrt(max(0.0, 1.0 + r11 - r00 - r22)) * 2.0
        w = (r02 - r20) / s
        x = (r01 + r10) / s
        y = 0.25 * s
        z = (r12 + r21) / s
    else:
        s = math.sqrt(max(0.0, 1.0 + r22 - r00 - r11)) * 2.0
        w = (r10 - r01) / s
        x = (r02 + r20) / s
        y = (r12 + r21) / s
        z = 0.25 * s
    return quat_normalize((x, y, z, w))


def euler_xyz(quat: Vec4) -> Vec3:
    """Quaternion to the XYZ Euler angles an SMD skeleton line carries.

    Verified against the compiler's BlenderSourceTools fixture: the root quaternion
    ``(0.683, 0.183, 0.183, 0.683)`` becomes ``(1.570796, 0, 0.523599)``, which is exactly
    the line in ``blender_cube.smd``. A different order (ZYX, or Blender's to_euler('XYZ'))
    would compile and put every bone in the wrong place.
    """
    x, y, z, w = quat
    roll = math.atan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y))
    pitch = math.asin(max(-1.0, min(1.0, 2.0 * (w * y - z * x))))
    yaw = math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))
    return roll, pitch, yaw


def mat4_decompose(m: Mat4, tolerance: float = 1e-4) -> tuple[Vec3, Vec4, Vec3, bool]:
    """``(translation, quaternion, scale, mirrored)`` for an affine matrix.

    SMD has no bone scale, so the caller has to decide what to do with a scale that is not
    one. A mirrored basis (negative determinant) is reported rather than hidden: flipping
    one column makes the rotation proper and the flag says which way the mesh was wound.
    """
    translation = (m[0][3], m[1][3], m[2][3])
    columns = [(m[0][c], m[1][c], m[2][c]) for c in range(3)]
    scale = tuple(math.sqrt(sum(v * v for v in column)) for column in columns)
    if any(s < tolerance for s in scale):
        return translation, (0.0, 0.0, 0.0, 1.0), scale, False

    determinant = (
        columns[0][0] * (columns[1][1] * columns[2][2] - columns[1][2] * columns[2][1])
        - columns[0][1] * (columns[1][0] * columns[2][2] - columns[1][2] * columns[2][0])
        + columns[0][2] * (columns[1][0] * columns[2][1] - columns[1][1] * columns[2][0])
    )
    mirrored = determinant < 0.0
    factors = list(scale)
    if mirrored:
        factors[0] = -factors[0]
    rotation = [
        [columns[0][r] / factors[0], columns[1][r] / factors[1], columns[2][r] / factors[2], 0.0]
        for r in range(3)
    ]
    rotation.append([0.0, 0.0, 0.0, 1.0])
    return translation, quat_from_matrix(rotation), tuple(factors), mirrored


def vec3_lerp(a: Sequence[float], b: Sequence[float], t: float) -> Vec3:
    return (
        float(a[0]) + (float(b[0]) - float(a[0])) * t,
        float(a[1]) + (float(b[1]) - float(a[1])) * t,
        float(a[2]) + (float(b[2]) - float(a[2])) * t,
    )


def quat_slerp(a: Sequence[float], b: Sequence[float], t: float) -> Vec4:
    """Shortest-arc spherical interpolation, with a linear fallback when nearly equal.

    glTF rotation channels are quaternions and ``LINEAR`` means slerp, not component-wise
    lerp. A near-identical pair is common (a key that does not move) and normalising a
    component lerp there is both cheaper and free of the antipodal branch.
    """
    ax, ay, az, aw = quat_normalize(a)
    bx, by, bz, bw = quat_normalize(b)
    dot = ax * bx + ay * by + az * bz + aw * bw
    if dot < 0.0:
        bx, by, bz, bw = -bx, -by, -bz, -bw
        dot = -dot
    if dot > 0.9995:
        return quat_normalize(
            (
                ax + (bx - ax) * t,
                ay + (by - ay) * t,
                az + (bz - az) * t,
                aw + (bw - aw) * t,
            )
        )
    theta = math.acos(max(-1.0, min(1.0, dot)))
    sin_theta = math.sin(theta)
    if abs(sin_theta) < 1e-12:
        return (ax, ay, az, aw)
    wa = math.sin((1.0 - t) * theta) / sin_theta
    wb = math.sin(t * theta) / sin_theta
    return quat_normalize((ax * wa + bx * wb, ay * wa + by * wb, az * wa + bz * wb, aw * wa + bw * wb))


def normalize3(vector: Sequence[float]) -> Vec3:
    x, y, z = float(vector[0]), float(vector[1]), float(vector[2])
    length = math.sqrt(x * x + y * y + z * z)
    if length < 1e-12:
        return (0.0, 0.0, 1.0)
    return (x / length, y / length, z / length)


def gltf_to_source(point: Sequence[float]) -> Vec3:
    """glTF's +Y-up to Source's +Z-up: ``(x, y, z) -> (x, -z, y)``."""
    return (float(point[0]), -float(point[2]), float(point[1]))


def mat4_axis_scale(axis_y_up: bool, scale: float) -> Mat4:
    """The scene-level transform: optional Y-up->Z-up, then a uniform scale."""
    if axis_y_up:
        rotation = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, -1.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
    else:
        rotation = mat4_identity()
    return mat4_mul(mat4_scale(scale, scale, scale), rotation)


def flatten(numbers: Iterable[float]) -> list[float]:
    return [float(value) for value in numbers]
