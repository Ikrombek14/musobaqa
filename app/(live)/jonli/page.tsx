import { permanentRedirect } from "next/navigation";

/**
 * Jonli tablo endi bosh sahifada. Eski `/jonli` manzili yashab qoladi —
 * chop etilgan qogʻoz yoki kimningdir xatcho'pidagi havola buzilmasin.
 */
export default function LiveIndexRedirect(): never {
  permanentRedirect("/");
}
