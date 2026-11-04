import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import {
  BackSide,
  Color,
  Data3DTexture,
  GLSL3,
  LinearFilter,
  Plane,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  Vector4,
} from "three";

type ConnectivityVolumeProps = {
  center?: [number, number, number];
  clipEnabled: boolean;
  clippingPlane: Plane;
  highColor: string;
  lowColor: string;
  opacity: number;
  renderOrder?: number;
  spacingMm: number | [number, number, number];
  shape: [number, number, number];
  threshold: number;
  url: string;
};

export default function ConnectivityVolume({
  center = [0, 0, 0],
  clipEnabled,
  clippingPlane,
  highColor,
  lowColor,
  opacity,
  renderOrder = 10,
  spacingMm,
  shape,
  threshold,
  url,
}: ConnectivityVolumeProps) {
  const invalidate = useThree((state) => state.invalidate);
  const [texture, setTexture] = useState<Data3DTexture | null>(null);
  const spacing = useMemo(
    () => typeof spacingMm === "number"
      ? new Vector3(spacingMm, spacingMm, spacingMm)
      : new Vector3(...spacingMm),
    [spacingMm],
  );
  const size = useMemo(
    () => new Vector3(shape[0] * spacing.x, shape[1] * spacing.y, shape[2] * spacing.z),
    [shape, spacing],
  );

  useEffect(() => {
    const controller = new AbortController();
    setTexture(null);
    void fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Volume de connectivité indisponible");
        return response.arrayBuffer();
      })
      .then((buffer) => {
        const expectedLength = shape[0] * shape[1] * shape[2];
        const data = new Uint8Array(buffer);
        if (data.length !== expectedLength) {
          throw new Error("Dimensions du volume de connectivité incompatibles");
        }
        const nextTexture = new Data3DTexture(data, shape[0], shape[1], shape[2]);
        nextTexture.format = RedFormat;
        nextTexture.type = UnsignedByteType;
        nextTexture.minFilter = LinearFilter;
        nextTexture.magFilter = LinearFilter;
        nextTexture.unpackAlignment = 1;
        nextTexture.needsUpdate = true;
        setTexture(nextTexture);
        invalidate();
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setTexture(null);
        }
      });
    return () => controller.abort();
  }, [invalidate, shape, url]);

  useEffect(() => () => texture?.dispose(), [texture]);

  const uniforms = useMemo(() => ({
    boxSize: { value: size },
    clipEnabled: { value: false },
    clipPlane: { value: new Vector4() },
    highColor: { value: new Color(highColor) },
    lowColor: { value: new Color(lowColor) },
    opacity: { value: opacity },
    threshold: { value: threshold },
    volume: { value: texture },
  }), []);

  const material = useMemo(() => new ShaderMaterial({
    side: BackSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms,
    glslVersion: GLSL3,
    vertexShader: `
      out vec3 rayOrigin;
      out vec3 rayDirection;
      void main() {
        rayOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        rayDirection = position - rayOrigin;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      precision highp sampler3D;
      uniform sampler3D volume;
      uniform mat4 modelMatrix;
      uniform vec3 boxSize;
      uniform vec3 lowColor;
      uniform vec3 highColor;
      uniform vec4 clipPlane;
      uniform float opacity;
      uniform float threshold;
      uniform bool clipEnabled;
      in vec3 rayOrigin;
      in vec3 rayDirection;
      out vec4 outputColor;

      vec2 intersectBox(vec3 origin, vec3 direction) {
        vec3 inverseDirection = 1.0 / direction;
        vec3 first = (-boxSize * 0.5 - origin) * inverseDirection;
        vec3 second = (boxSize * 0.5 - origin) * inverseDirection;
        vec3 minimum = min(first, second);
        vec3 maximum = max(first, second);
        return vec2(max(max(minimum.x, minimum.y), minimum.z), min(min(maximum.x, maximum.y), maximum.z));
      }

      void main() {
        vec3 direction = normalize(rayDirection);
        vec2 bounds = intersectBox(rayOrigin, direction);
        if (bounds.x > bounds.y) discard;
        bounds.x = max(bounds.x, 0.0);
        float maximum = 0.0;
        for (int index = 0; index < 112; index += 1) {
          float positionAlongRay = mix(bounds.x, bounds.y, (float(index) + 0.5) / 112.0);
          vec3 localPosition = rayOrigin + positionAlongRay * direction;
          vec4 worldPosition = modelMatrix * vec4(localPosition, 1.0);
          if (!clipEnabled || dot(clipPlane.xyz, worldPosition.xyz) + clipPlane.w >= 0.0) {
            vec3 uv = localPosition / boxSize + 0.5;
            maximum = max(maximum, texture(volume, uv).r);
          }
        }
        if (maximum < threshold) discard;
        float visibleStrength = clamp((maximum - threshold) / max(0.001, 1.0 - threshold), 0.0, 1.0);
        vec3 color = mix(lowColor, highColor, pow(maximum, 1.7));
        float alpha = opacity * mix(0.18, 1.0, pow(visibleStrength, 0.7));
        outputColor = vec4(color, alpha);
      }
    `,
  }), [uniforms]);

  useEffect(() => {
    uniforms.boxSize.value.copy(size);
    uniforms.clipEnabled.value = clipEnabled;
    uniforms.clipPlane.value.set(
      clippingPlane.normal.x,
      clippingPlane.normal.y,
      clippingPlane.normal.z,
      clippingPlane.constant,
    );
    uniforms.highColor.value.set(highColor);
    uniforms.lowColor.value.set(lowColor);
    uniforms.opacity.value = opacity;
    uniforms.threshold.value = threshold;
    uniforms.volume.value = texture;
    invalidate();
  }, [clipEnabled, clippingPlane, highColor, invalidate, lowColor, opacity, size, texture, threshold, uniforms]);

  useEffect(() => () => material.dispose(), [material]);

  if (!texture) return null;
  return (
    <mesh position={center} material={material} renderOrder={renderOrder}>
      <boxGeometry args={[size.x, size.y, size.z]} />
    </mesh>
  );
}
