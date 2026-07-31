import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          borderRadius: 16,
          background: "linear-gradient(145deg, #8995ff 0%, #6c7bff 48%, #4d5edc 100%)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.24)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 6,
            width: 52,
            height: 21,
            borderRadius: 14,
            background: "linear-gradient(180deg, rgba(255,255,255,0.26), rgba(255,255,255,0))",
          }}
        />
        <div
          style={{
            display: "flex",
            width: 30,
            height: 30,
            flexWrap: "wrap",
            gap: 3,
          }}
        >
          {Array.from({ length: 9 }, (_, index) => (
            <div
              key={index}
              style={{
                width: 8,
                height: 8,
                borderRadius: 2.5,
                background: index % 2 === 0
                  ? "rgba(255,255,255,0.55)"
                  : "rgba(255,255,255,0.95)",
              }}
            />
          ))}
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
