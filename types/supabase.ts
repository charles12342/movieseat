export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      movies: {
        Row: {
          id: string
          tmdb_id: number | null
          title: string
          overview: string | null
          poster_path: string | null
          backdrop_path: string | null
          runtime: number
          genres: string[]
          rating: string | null
          format_badges: string[]
          created_at: string
        }
        Insert: {
          id?: string
          tmdb_id?: number | null
          title: string
          overview?: string | null
          poster_path?: string | null
          backdrop_path?: string | null
          runtime: number
          genres?: string[]
          rating?: string | null
          format_badges?: string[]
          created_at?: string
        }
        Update: {
          id?: string
          tmdb_id?: number | null
          title?: string
          overview?: string | null
          poster_path?: string | null
          backdrop_path?: string | null
          runtime?: number
          genres?: string[]
          rating?: string | null
          format_badges?: string[]
          created_at?: string
        }
      }
      auditoriums: {
        Row: {
          id: string
          name: string
          screen_type: string
          sound_system: string
          total_seats: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          screen_type: string
          sound_system: string
          total_seats: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          screen_type?: string
          sound_system?: string
          total_seats?: number
          created_at?: string
        }
      }
      seats: {
        Row: {
          id: string
          auditorium_id: string
          row: string
          number: number
          seat_type: 'standard' | 'vip'
          is_wheelchair: boolean
          created_at: string
        }
        Insert: {
          id?: string
          auditorium_id: string
          row: string
          number: number
          seat_type?: 'standard' | 'vip'
          is_wheelchair?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          auditorium_id?: string
          row?: string
          number?: number
          seat_type?: 'standard' | 'vip'
          is_wheelchair?: boolean
          created_at?: string
        }
      }
      showtimes: {
        Row: {
          id: string
          movie_id: string
          auditorium_id: string
          start_time: string
          end_time: string
          price_standard: number
          price_vip: number
          created_at: string
        }
        Insert: {
          id?: string
          movie_id: string
          auditorium_id: string
          start_time: string
          end_time: string
          price_standard?: number
          price_vip?: number
          created_at?: string
        }
        Update: {
          id?: string
          movie_id?: string
          auditorium_id?: string
          start_time?: string
          end_time?: string
          price_standard?: number
          price_vip?: number
          created_at?: string
        }
      }
      showtime_templates: {
        Row: {
          id: string
          movie_id: string
          auditorium_id: string
          start_time_of_day: string
          price_standard: number
          price_vip: number
          created_at: string
        }
        Insert: {
          id?: string
          movie_id: string
          auditorium_id: string
          start_time_of_day: string
          price_standard?: number
          price_vip?: number
          created_at?: string
        }
        Update: {
          id?: string
          movie_id?: string
          auditorium_id?: string
          start_time_of_day?: string
          price_standard?: number
          price_vip?: number
          created_at?: string
        }
      }
      seat_holds: {
        Row: {
          id: string
          showtime_id: string
          seat_id: string
          user_id: string
          session_id: string
          created_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          showtime_id: string
          seat_id: string
          user_id: string
          session_id: string
          created_at?: string
          expires_at: string
        }
        Update: {
          id?: string
          showtime_id?: string
          seat_id?: string
          user_id?: string
          session_id?: string
          created_at?: string
          expires_at?: string
        }
      }
      reservations: {
        Row: {
          id: string
          reference_code: string
          showtime_id: string
          user_id: string
          customer_name: string
          customer_email: string
          status: 'active' | 'cancelled' | 'completed'
          total_amount: number
          created_at: string
          cancelled_at: string | null
        }
        Insert: {
          id?: string
          reference_code: string
          showtime_id: string
          user_id: string
          customer_name: string
          customer_email: string
          status?: 'active' | 'cancelled' | 'completed'
          total_amount: number
          created_at?: string
          cancelled_at?: string | null
        }
        Update: {
          id?: string
          reference_code?: string
          showtime_id?: string
          user_id?: string
          customer_name?: string
          customer_email?: string
          status?: 'active' | 'cancelled' | 'completed'
          total_amount?: number
          created_at?: string
          cancelled_at?: string | null
        }
      }
      reservation_seats: {
        Row: {
          id: string
          reservation_id: string
          showtime_id: string
          seat_id: string
          price: number
          status: 'reserved' | 'cancelled'
          created_at: string
        }
        Insert: {
          id?: string
          reservation_id: string
          showtime_id: string
          seat_id: string
          price: number
          status?: 'reserved' | 'cancelled'
          created_at?: string
        }
        Update: {
          id?: string
          reservation_id?: string
          showtime_id?: string
          seat_id?: string
          price?: number
          status?: 'reserved' | 'cancelled'
          created_at?: string
        }
      }
      otp_codes: {
        Row: {
          id: string
          email: string
          code_hash: string
          created_at: string
          expires_at: string
          attempts: number
          is_used: boolean
        }
        Insert: {
          id?: string
          email: string
          code_hash: string
          created_at?: string
          expires_at: string
          attempts?: number
          is_used?: boolean
        }
        Update: {
          id?: string
          email?: string
          code_hash?: string
          created_at?: string
          expires_at?: string
          attempts?: number
          is_used?: boolean
        }
      }
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      my_reservations: {
        Row: {
          reservation_id: string
          reference_code: string
          status: 'active' | 'cancelled' | 'completed'
          total_amount: number
          created_at: string
          cancelled_at: string | null
          customer_name: string
          customer_email: string
          user_id: string
          showtime_id: string
          start_time: string
          end_time: string
          movie_id: string
          movie_title: string
          poster_path: string | null
          runtime: number
          rating: string | null
          auditorium_id: string
          auditorium_name: string
          screen_type: string
          sound_system: string
          seats: {
            seat_id: string
            row: string
            number: number
            seat_type: 'standard' | 'vip'
            price: number
          }[]
        }
      }
    }
    Functions: {
      hold_seats: {
        Args: {
          p_showtime_id: string
          p_seat_ids: string[]
          p_session_id: string
        }
        Returns: {
          success: boolean
          expires_at: string
          held_count: number
        }
      }
      release_holds: {
        Args: {
          p_showtime_id: string
        }
        Returns: {
          success: boolean
          released_count: number
        }
      }
      confirm_reservation: {
        Args: {
          p_showtime_id: string
          p_customer_name: string
          p_customer_email: string
        }
        Returns: {
          success: boolean
          reservation_id: string
          reference_code: string
          total_amount: number
        }
      }
      cancel_reservation: {
        Args: {
          p_reservation_id: string
        }
        Returns: {
          success: boolean
          message: string
        }
      }
      reseed_today: {
        Args: Record<string, never>
        Returns: {
          success: boolean
          date: string
          showtimes_created: number
        }
      }
      generate_reservation_reference: {
        Args: Record<string, never>
        Returns: string
      }
    }
  }
}
