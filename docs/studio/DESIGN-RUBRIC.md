# Game Design Rubric — Project VEIL

Khung phân tích thiết kế game trích lọc từ `game-designer` và chipset `traditional-roguelike` của CCGS, áp dụng riêng cho **Project VEIL**. Dùng tài liệu này mỗi khi cân nhắc thêm phòng, kẻ địch, vật phẩm, trait, hội thoại hoặc cân bằng chỉ số.

---

## 1. Bốn trụ cột của Project VEIL (Design Pillars)

Mọi thay đổi thiết kế mới phải phục vụ ít nhất **1** trụ cột và **không được phá vỡ** trụ cột nào dưới đây:

1. **Chiến thuật lưới theo lượt đọc hiểu ngay (Readable Turn-by-Turn Grid):**
   - 1 thao tác = 1 lượt. Không gì di chuyển khi người chơi đang suy nghĩ.
   - Mọi đòn đánh, trạng thái `provoked`, bẫy hay bước tiến của kẻ địch đều có thể đọc trước qua Canvas + 1-tap Inspect + Nhật ký hành động.
2. **Nhận thức hai lớp (Perception / Lucidity Duality):**
   - Cùng một sự kiện cơ học, nhưng ý nghĩa cảm xúc và đạo đức thay đổi hoàn toàn khi `lucidity` tăng từ **Ảo giác (`illusion`) → Nhiễu (`glitch`) → Sự thật (`truth`)**.
   - Cơ chế gameplay và câu chuyện phải phản chiếu nhau (ví dụ: nhặt `warm_bread` hay tấn công dân thường tăng `lucidity` vì hành vi trái ngược với hình ảnh "thây ma").
3. **Bản sắc Build rõ ràng (Race × Class Identity):**
   - 3 Chủng tộc (`human`, `dark_elf`, `undead_outsider`) × 3 Lớp nghề (`brawler`, `iron_vanguard`, `spellblade`) tạo ra 9 lối chơi khác nhịp nhau thật sự (hồi phục / tăng tỉnh táo / chịu đòn / dồn combo / phản công thế thủ / dồn sát thương mở màn), không chỉ đổi vài điểm chỉ số thụ động.
4. **Lựa chọn có hệ quả thật (Meaningful Branching):**
   - Ngã rẽ `KEEP` (sức mạnh ngay lập tức + khóa Màn Che) vs `BREAK` (từ bỏ buff, mở giao tiếp hòa bình & đối mặt sự thật) phải tạo ra đường chơi và 3 kết cục khác hẳn nhau (`SUMMONER_BLADE`, `Kẻ Phá Luật`, `AWAKENED`).

---

## 2. Khung đánh giá khi đề xuất thay đổi (MDA + Flow + SDT)

Trước khi chốt một hệ thống hoặc đợt cân bằng mới, trả lời nhanh 3 nhóm câu hỏi:

### A. MDA (Mechanics → Dynamics → Aesthetics)
- **Mechanic:** Quy tắc mới chính xác là gì? Dùng dữ liệu nào trong `src/data/`?
- **Dynamic:** Người chơi sẽ nảy sinh chiến thuật mới nào? Có chiến thuật "một nút thắng hết" (dominant strategy) làm vô hiệu hóa các build khác không?
- **Aesthetic:** Nó tăng cảm giác *căng thẳng đạo đức*, *tính toán sát nút*, hay *tò mò khám phá sự thật*?

### B. Flow & Cân bằng chiến đấu
- **Kiểm tra cận biên 9 Build:** Build yếu nhất về HP/ATK (ví dụ `dark_elf` + `spellblade`) và build thiên thủ (`undead_outsider` + `iron_vanguard`) có cùng vượt được `captain_01` (110 HP, 16 ATK) không cần `summoner_blessing` bằng chiến thuật hợp lý không?
- **Giá trị của lệnh `WAIT` và vật phẩm:** Lệnh `Chờ` và bình hồi máu (tốn 1 lượt) có tạo ra tình huống "cân não sát nút" thay vì chỉ spam nút đi tới?
- **Tốc độ leo `lucidity`:** Người chơi đi đường tự nhiên (không dùng nút debug `+15 Tỉnh táo`) có chạm ngưỡng `glitch` (>=30) ở Phòng 2 và ngưỡng `filterChoice` (>=70) đúng cao trào Phòng 3 không?

### C. SDT (Động lực người chơi)
- **Autonomy (Tự chủ):** Người chơi có biết mình *có thể* ngừng đánh, né tránh, hoặc nói chuyện sau `BREAK` không?
- **Competence (Làm chủ):** Nếu người chơi chết hoặc kích hoạt `provoked` ngoài ý muốn, Nhật ký & Inspect có giải thích rõ **tại sao** để lần chơi sau rút kinh nghiệm được không?

---

## 3. Lan can cảm giác chơi (Traditional Roguelike Guardrails)

- **Chống nhiễu Nhật ký:** Không lặp câu thoại chiến đấu (bark spam) mỗi lượt; chỉ phát thoại khi đổi trạng thái (`provoked` đổi hoặc sang phòng mới).
- **Tín hiệu nguy hiểm rõ ràng:** Máu thấp, kẻ địch `provoked` vs `Hòa bình — Tiếp cận để giao tiếp`, và Boss phải phân biệt ngay bằng mắt trên Canvas lẫn thẻ Inspect.
- **Một màn hình Mobile gọn gàng:** Người chơi điện thoại (`375×667`) nhìn thấy đồng thời HUD 1 dòng + Bản đồ Canvas + Nhật ký + D-pad mà không phải cuộn trang liên tục trong lúc đánh nhau.
- **Chưa cần vội (Scope Guard):** Tránh nhồi hệ thống mới nặng (hunger, shop phức tạp, procedural dungeon nhiều tầng, save cloud) trước khi vòng lặp 3 phòng + nhận thức + 9 build đạt độ sắc nét tối đa.
