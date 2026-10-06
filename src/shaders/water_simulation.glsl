precision highp float;

uniform float u_time;
uniform float u_waterElevation;
uniform vec3 u_shallowColor;
uniform vec3 u_deepColor;

varying vec3 v_positionEC;
varying vec3 v_normalEC;
varying vec2 v_uv;

void main() {
    float wave1 = sin(v_uv.x * 24.0 + u_time * 1.5);
    float wave2 = cos(v_uv.y * 32.0 + u_time * 2.0);
    float waveComposite = (wave1 + wave2) * 0.06;

    float depthFactor = clamp((u_waterElevation - v_positionEC.z + waveComposite) / 5.0, 0.0, 1.0);
    vec3 baseWaterColor = mix(u_shallowColor, u_deepColor, depthFactor);

    vec3 lightDir = normalize(vec3(0.3, 0.4, 0.8));
    vec3 normal = normalize(v_normalEC + vec3(wave1 * 0.05, wave2 * 0.05, 1.0));
    float specular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 32.0);

    vec3 finalColor = baseWaterColor + vec3(specular * 0.4);
    gl_FragColor = vec4(finalColor, 0.82);
}
