# Google Veo Video Generation Prompt

**Copy and paste this exact prompt into Google AI Studio (Veo) to generate the "Reality Check" video for the hackathon demo.**

---

**Prompt:**

> Cinematic close-up, 4k resolution, shot on a 50mm lens. A person's hand is holding a matte silicone iPhone 16 phone case under bright, natural daylight near a window. The camera slowly pans around the phone case. 
>
> The key visual focus is the color of the case: it is a dingy, off-white, slightly yellowish-grey color, looking cheap and discolored. To emphasize the discoloration, the hand places the phone case down onto a sheet of pure, bright white printer paper. The contrast clearly shows that the case is an ugly yellowish-off-white, not pure white. 
> 
> The lighting is realistic, highlighting the slightly greasy/matte texture of the silicone. No text, no logos. Highly photorealistic, documentary style.

---

### How to add the generated video to DarkWatch:
1. Download the generated `.mp4` file from AI Studio.
2. Rename it to `veo-case-demo.mp4`.
3. Move the file into the `public/` folder of this project (`/home/adoreblvnk/Documents/Darkwatch/public/veo-case-demo.mp4`).
4. Open `app/api/scan/route.ts`.
5. Scroll down to line 118 (inside the `veoValidation` object).
6. Change the `videoUrl` from the generic Google storage link to:
   `videoUrl: '/veo-case-demo.mp4',`